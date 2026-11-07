// Actualización diaria del dashboard.
//
// La ejecuta el Programador de tareas de Windows varias veces al día (al iniciar
// sesión, al conectarse a una red y cada 15 minutos), pero solo descarga datos
// una vez por día de Lima. Garantías:
//   - Un único proceso a la vez (archivo de bloqueo con detección de bloqueos huérfanos).
//   - Sin internet no se cuenta como fallo: el día queda pendiente y se reintenta.
//   - Los fallos reales (fuente caída, datos inválidos) esperan cada vez más
//     (15, 30, 60, 120, 180 min) para no saturar Andina ni el JNE.
//   - Los pasos se registran por separado: si falla el build no se vuelve a descargar.
//   - Se valida lo generado antes de dar el día por actualizado.
//
// Opciones: --publish (también Supabase), --force (ignora día y espera), --status.
import {spawnSync} from 'node:child_process';
import {closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../research/', import.meta.url);
const stateFile = new URL('actualizacion-diaria.json', directory);
const temporaryState = new URL('actualizacion-diaria.json.tmp', directory);
const lockFile = new URL('actualizacion-diaria.lock', directory);
const logFile = new URL('actualizacion-diaria.log', directory);
const oldLogFile = new URL('actualizacion-diaria.log.1', directory);

const MAX_LOG_BYTES = 512 * 1024;
const STALE_LOCK_MS = 30 * 60 * 1000;
const STEP_TIMEOUT_MS = 8 * 60 * 1000;
const CONNECTIVITY_URLS = ['https://andina.pe/', 'https://votoinformado.jne.gob.pe/'];
export const BACKOFF_MINUTES = [15, 30, 60, 120, 180];

export const limaDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {dateStyle: 'short', timeZone: 'America/Lima'}).format(date);

/** Minutos de espera tras `failures` fallos consecutivos del mismo día. */
export function backoffMinutes(failures) {
  if (failures < 1) return 0;
  return BACKOFF_MINUTES[Math.min(failures, BACKOFF_MINUTES.length) - 1];
}

/** Pasos pendientes para el día indicado, en orden. */
export function pendingSteps(state, day, publish) {
  const steps = [];
  // Estados de la versión anterior solo guardaban localDay (descarga + build juntos).
  const mapDone = state.mapDay === day || (state.mapDay === undefined && state.localDay === day);
  // Datos nuevos siempre requieren reconstruir dist/.
  if (!mapDone) steps.push('map', 'build');
  else if (state.localDay !== day) steps.push('build');
  if (publish && state.supabaseDay !== day) steps.push('publish');
  return steps;
}

/** Decide si corresponde ejecutar ahora. Devuelve {run, reason}. */
export function decide(state, {now = new Date(), publish = false, force = false} = {}) {
  const day = limaDay(now);
  const steps = pendingSteps(state, day, publish);
  if (!steps.length && !force) return {run: false, reason: 'already-updated', day, steps};
  if (!force && state.failureDay === day && state.nextAttemptAt && Date.parse(state.nextAttemptAt) > now.getTime()) {
    return {run: false, reason: 'backoff', day, steps};
  }
  return {run: true, reason: force ? 'forced' : 'pending', day, steps: steps.length ? steps : ['map', 'build', ...(publish ? ['publish'] : [])]};
}

/** Registra un fallo real y calcula el próximo intento. */
export function recordFailure(state, error, now = new Date()) {
  const day = limaDay(now);
  const failures = state.failureDay === day ? (state.failures || 0) + 1 : 1;
  return {
    ...state, failureDay: day, failures, lastError: String(error?.message || error),
    lastResult: 'error', lastAttemptAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + backoffMinutes(failures) * 60000).toISOString()
  };
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) return {}; // estado dañado: se reconstruye
    throw error;
  }
}

function saveState(state) {
  writeFileSync(temporaryState, JSON.stringify(state, null, 2) + '\n');
  renameSync(temporaryState, stateFile);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockFile, 'wx');
      writeSync(fd, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try { holder = JSON.parse(readFileSync(lockFile, 'utf8')); } catch {}
      const age = Date.now() - (Date.parse(holder?.startedAt) || statSync(lockFile).mtimeMs);
      if (holder?.pid && processAlive(holder.pid) && age < STALE_LOCK_MS) return false;
      rmSync(lockFile, {force: true}); // bloqueo huérfano
    }
  }
  return false;
}

function openLog() {
  try {
    if (statSync(logFile).size > MAX_LOG_BYTES) renameSync(logFile, oldLogFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fd = openSync(logFile, 'a');
  return {fd, write: message => writeSync(fd, `${new Date().toISOString()} ${message}\n`)};
}

async function hasInternet() {
  for (const url of CONNECTIVITY_URLS) {
    try {
      const response = await fetch(url, {method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'manual'});
      if (response.status > 0) return true;
    } catch {}
  }
  return false;
}

function validateOutputs() {
  const territorial = JSON.parse(readFileSync(new URL('../public/territorial.json', import.meta.url), 'utf8'));
  if (!Array.isArray(territorial.reports) || !territorial.reports.length) throw new Error('territorial.json no contiene reportes.');
  JSON.parse(readFileSync(new URL('../public/electoral-history.json', import.meta.url), 'utf8'));
  if (!existsSync(new URL('../dist/index.html', import.meta.url))) throw new Error('El build no generó dist/index.html.');
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const force = args.includes('--force');
  mkdirSync(directory, {recursive: true});

  if (args.includes('--status')) {
    const state = readState();
    console.log(JSON.stringify({...state, today: limaDay(), pending: pendingSteps(state, limaDay(), publish)}, null, 2));
    return;
  }

  let state = readState();
  const decision = decide(state, {publish, force});
  if (!decision.run) return; // nada que hacer: salida silenciosa y rápida

  if (!acquireLock()) return; // otra ejecución en curso
  const log = openLog();
  try {
    if (!(await hasInternet())) {
      log.write('Sin conexión a internet; la actualización del día queda pendiente.');
      state = {...state, lastResult: 'offline', lastAttemptAt: new Date().toISOString()};
      saveState(state);
      return;
    }

    try {
      loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const run = (script, scriptArgs = [], env = process.env) => {
      const started = Date.now();
      const result = spawnSync(process.execPath, [script, ...scriptArgs], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', log.fd, log.fd], timeout: STEP_TIMEOUT_MS
      });
      if (result.error) throw new Error(`${script}: ${result.error.code === 'ETIMEDOUT' ? 'tiempo agotado' : result.error.message}`);
      if (result.status !== 0) throw new Error(`Falló ${script} (código ${result.status ?? result.signal}).`);
      log.write(`${script} terminó en ${Math.round((Date.now() - started) / 1000)} s.`);
    };

    const {day} = decision;
    log.write(`Inicio (${decision.reason}); pasos: ${decision.steps.join(', ')}.`);
    if (decision.steps.includes('map')) {
      run('scripts/sync-map.mjs', ['--require-current-reports']);
      state = {...state, mapDay: day};
      saveState(state);
    }
    if (decision.steps.includes('build')) {
      const env = {...process.env};
      if (!env.SUPABASE_PUBLISHABLE_KEY) delete env.SUPABASE_URL;
      run('scripts/build.mjs', [], env);
      validateOutputs();
      state = {...state, localDay: day};
      saveState(state);
      log.write('Dashboard local actualizado.');
    }
    if (decision.steps.includes('publish')) {
      run('scripts/history.mjs', ['publish']);
      state = {...state, supabaseDay: day};
      saveState(state);
      log.write('Historial de Supabase actualizado.');
    }
    state = {...state, lastResult: 'ok', lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(),
      failures: 0, failureDay: null, nextAttemptAt: null, lastError: null};
    saveState(state);
  } catch (error) {
    state = recordFailure(state, error);
    saveState(state);
    log.write(`ERROR: ${state.lastError} Fallo ${state.failures} del día; próximo intento desde ${state.nextAttemptAt}.`);
    process.exitCode = 1;
  } finally {
    closeSync(log.fd);
    rmSync(lockFile, {force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
