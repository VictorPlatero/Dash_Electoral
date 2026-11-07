param(
    [string] $Node,
    [switch] $PublicarEnSupabase,
    [switch] $Desinstalar
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$taskName = 'Dash Electoral - Actualizacion diaria'

if ($Desinstalar) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Tarea eliminada: $taskName"
    return
}

# --- Node compatible con package.json (>=22.13 <25) -------------------------
function Test-NodeVersion([string] $path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
    $raw = (& $path -v) 2>$null
    if ($raw -notmatch '^v(\d+)\.(\d+)') { return $false }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    return ($major -gt 22 -or ($major -eq 22 -and $minor -ge 13)) -and $major -lt 25
}

# Preferimos instalaciones estables del sistema antes que runtimes de otras herramientas.
$candidates = @()
if ($Node) { $candidates += $Node }
$candidates += Join-Path $env:ProgramFiles 'nodejs\node.exe'
$candidates += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'
$candidates += (Get-Command node -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object Source)
$candidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'

$nodePath = $candidates | Where-Object { Test-NodeVersion $_ } | Select-Object -First 1
if (-not $nodePath) {
    throw 'No se encontró Node.js >=22.13 y <25. Instálalo con: winget install OpenJS.NodeJS.LTS --version 24.22.1'
}
$nodePath = (Resolve-Path -LiteralPath $nodePath).Path

# --- Acción: Node oculto mediante wscript (sin ventanas emergentes) ---------
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$launcher = Join-Path $PSScriptRoot 'run-hidden.vbs'
$arguments = '//B //NoLogo "{0}" "{1}" scripts/sync-daily.mjs' -f $launcher, $nodePath
if ($PublicarEnSupabase) { $arguments += ' --publish' }
$action = New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $project

# --- Disparadores ------------------------------------------------------------
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# 1) Al iniciar sesión (con un minuto para que la red se estabilice).
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$logon.Delay = 'PT1M'
# 2) Cada 15 minutos, indefinidamente (cubre reanudación tras suspensión).
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15)
# 3) En cuanto Windows se conecta a una red (evento 10000 de NetworkProfile).
$eventClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$network = New-CimInstance -CimClass $eventClass -ClientOnly
$network.Enabled = $true
$network.Delay = 'PT30S'
$network.Subscription = @'
<QueryList><Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"><Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[(EventID=10000)]]</Select></Query></QueryList>
'@

# --- Configuración -----------------------------------------------------------
# No se usa RunOnlyIfNetworkAvailable: el script comprueba internet real y registra
# el intento; así una red sin salida a internet no deja la tarea en silencio.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 25)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat, $network) -Settings $settings `
    -Principal $principal -Force `
    -Description 'Actualiza los resultados electorales de Tacna una vez al día cuando hay internet (Dash_Electoral).' | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Output "Tarea registrada: $taskName"
Write-Output "Node: $nodePath ($(& $nodePath -v))"
Write-Output 'Estado: node scripts/sync-daily.mjs --status'
