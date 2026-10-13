# Tacna Decide — resultados y hojas de vida

Dashboard en español de las elecciones regionales y municipales de Tacna. Incluye una base SQLite persistente, hojas de vida individuales, análisis descriptivo y comparación de hasta tres candidatos al mismo cargo y ámbito. Conserva los resultados parciales, contexto y servicios para vecinos del proyecto original.

## Ejecutar

Requiere Node.js **22.13 o superior** (probado con 24.19). No requiere paquetes ni claves para consultar las fichas descargadas.

```sh
npm run build
npm start
```

Si no tienes npm en el PATH, los comandos equivalentes son:

```sh
node scripts/build.mjs
node scripts/serve.mjs
```

Abre http://127.0.0.1:4173/#candidatos. La primera ejecución importa `public/candidates.json` en `storage/candidates.sqlite`. Se conservan las importaciones manuales al reiniciar; la semilla solo se vuelve a importar si cambia su contenido. Las actualizaciones se hacen por ID: no eliminan automáticamente fichas antiguas. El servidor escucha únicamente en el equipo local por defecto.

## Datos oficiales consultados

Consulta realizada el **13 de octubre de 2026** a la API pública de [Voto Informado del JNE](https://votoinformado.jne.gob.pe/): **21 hojas de vida**, 14 candidaturas a gobernador regional y 7 a alcalde provincial de Tacna. Solo se incluyen titulares de estos dos ámbitos, no vicegobernadores, consejeros, regidores ni alcaldes distritales.

Las listas municipales de Fuerza Tacna (39637) y Unidos por Tacna (40571) fueron devueltas por el JNE sin nombre ni identificador de DJHV del titular. Se registran como faltantes en `unavailableLists`, sin atribuirles una persona. El catálogo es una copia de lo disponible en esa consulta, no una certificación de todas las candidaturas vigentes.

Cada ficha conserva su URL, fecha, estado en el JNE y enlace al PDF cuando está disponible. Incluye formación, empleos, trayectoria política, registros judiciales, ingresos brutos anuales, cantidades de bienes e información adicional y anotaciones marginales. Se omiten DNI, domicilios personales y placas en el catálogo público. Los datos son declaraciones del postulante ante el JNE; no equivalen a una auditoría independiente.

## Análisis y comparación

- Búsqueda sin distinción de tildes por nombre, partido y formación; filtros por cargo y organización; paginación y orden por nombre o consulta.
- Nivel de formación declarado y estado de conclusión de cada estudio. Un posgrado declarado no acredita automáticamente un grado de maestro o doctor.
- Años de experiencia con resolución anual: se resta inicio a término, se unen los períodos superpuestos y se limita el cálculo a 2026. Un empleo del mismo año aporta cero años medibles; fechas incompletas quedan excluidas y generan una aclaración.
- Registros penales y de obligaciones se muestran con su materia, fallo, expediente y fuente. Una absolución se distingue explícitamente; contar registros no determina condenas ni antecedentes.
- Cobertura de cinco secciones: formación, experiencia, trayectoria, declaraciones judiciales y finanzas. Mide revisión documental, no mérito ni calidad del candidato. Una sección pendiente conserva valores nulos, no cero.
- Comparador de hasta tres fichas del mismo cargo y ámbito. No usa puntajes ni recomienda un voto. Las anotaciones marginales se muestran como texto con el contenido original y la corrección; no se aplican automáticamente a otros campos.
- CSV con todas las coincidencias del filtro, aunque la pantalla esté paginada; protege las celdas que podrían interpretarse como fórmulas.

## Importar y mantener la base

En Candidatos, abre **Importar fichas**. Descarga un ejemplo de estructura (contiene una ficha real), edítalo y carga el JSON o pégalo. La vista previa permite revisar nombres y cargo; el servidor valida todos los campos antes de guardar el lote en una transacción. Un ID existente actualiza la ficha; otro ID agrega un registro. Incluye siempre una fuente HTTPS y una fecha de consulta válida. No importa directamente PDF o imágenes: la extracción oficial se realiza mediante el script JNE y los datos manuales se importan en JSON.

En localhost la administración está habilitada. Si defines `ADMIN_TOKEN`, debes introducir esa clave en el diálogo incluso en local. Fuera de localhost, las escrituras requieren la clave; sin clave configurada el acceso remoto es de lectura. La clave solo se mantiene mientras el diálogo está abierto. No publiques `.env` ni la base de trabajo en Git.

Puedes descargar todas las fichas de la base en JSON desde `/api/candidates/backup`. Ese archivo se puede restaurar con el importador; el CSV es para análisis tabular. Para respaldar el archivo SQLite directamente, detén el servidor antes de copiarlo, de modo que no queden escrituras pendientes en WAL.

Para consultar nuevamente el JNE:

```sh
npm run sync:jne
npm run build
npm start
```

O ejecuta `node scripts/sync-jne.mjs`. Detén el servidor antes del último comando si ya está abierto. La sincronización limita la concurrencia a tres consultas, aplica pausas, tiempo máximo y reintentos. Si una ficha falla, conserva la semilla anterior. `node scripts/sync-jne.mjs --resume` reutiliza respuestas consultadas hace menos de 24 horas para continuar después de una interrupción. La caché queda en `research/`, ignorada por Git. Esta opción conserva datos de esa ventana; para una consulta nueva omite `--resume`.

## Arquitectura y rendimiento

- Frontend HTML/CSS/JavaScript sin frameworks ni dependencias de producción.
- Módulo de candidatos y directorio ciudadano cargados al entrar en su sección.
- Búsqueda con debounce, cancelación de consultas anteriores y paginación (8 fichas por página).
- SQLite con WAL, claves foráneas, índices por cargo/organización y nombre, consultas parametrizadas, tablas relacionadas de formación, experiencia y registros judiciales; ficha completa y fuentes conservadas en JSON.
- Caché de archivos en memoria, compresión gzip y revalidación ETag/304. El catálogo inicial de unos 70 KB baja a unos 11 KB con gzip; depende del contenido.
- Tipografías del sistema, sin solicitudes externas a Google Fonts. Diseño adaptable, navegación por teclado, diálogos nativos y preferencia A+ persistida en el navegador.
- API con validación de lotes, límite de 2 MB y 500 fichas por importación, control de origen, clave administrativa en producción y cabeceras de seguridad. Datos de usuario se renderizan con `textContent`.

## Pruebas

```sh
npm test
```

O `node --test`. Las pruebas cubren solapamiento de experiencia, datos ausentes, absoluciones, ámbito y mapeo JNE, anotaciones, validación, importaciones sin cambios parciales, persistencia, autorización, filtros, paginación, respaldo, CSV y caché HTTP.

## Render

`render.yaml` ahora configura un **Web Service Node**, con disco persistente para SQLite, `DATABASE_PATH=/var/data/candidates.sqlite`, `HOST=0.0.0.0` y `ADMIN_TOKEN` generado. Build: `npm run build`. Start: `npm start`. Health check: `/api/health`.

La administración con SQLite requiere un servicio backend; una publicación solo estática no ofrece la API de candidatos. El Blueprint usa el plan Starter y un disco de 1 GB, ambos de pago. Revisa costos antes de desplegar. No se ha creado ningún servicio ni realizado una compra. [Documentación de discos de Render](https://render.com/docs/disks).

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/health` | Estado del servidor |
| GET | `/api/candidates/meta` | Totales, organizaciones, fuente y faltantes |
| GET | `/api/candidates?q=&role=&party=&sort=&page=&limit=` | Buscar; límite máximo 50 |
| GET | `/api/candidates/:id` | Hoja de vida y análisis |
| GET | `/api/candidates/export` | CSV de todas las coincidencias |
| GET | `/api/candidates/backup` | Respaldo JSON de todas las fichas |
| POST | `/api/candidates/import` | Lote `{ "candidates": [...] }`; JSON y autorización |

Variables: `PORT` (4173), `HOST` (127.0.0.1), `DATABASE_PATH` y `ADMIN_TOKEN`. La implementación está pensada para una instancia del servidor con SQLite; no comparte la base entre varias instancias.

## Información del proyecto original

Los resultados y el directorio ciudadano conservan su consulta del **6 de octubre de 2026**. Los porcentajes son reportes parciales de El Comercio del **5 de octubre**, atribuidos a ONPE, sin verificación directa de actas. Incluyen cinco organizaciones por cargo, no todas las listas ni una proclamación. El anillo muestra avance del conteo, no participación. Las autoridades 2023–2026 son contexto, no candidaturas inferidas.

La referencia territorial de PCM es de 2021. El padrón RENIEC sigue excluido por la contradicción entre título y cuerpo de la nota. Los contactos no confirmados del directorio permanecen señalados como pendientes; los trámites y consultas personales se abren en páginas oficiales. No se reciben DNI ni solicitudes ciudadanas. El checklist es orientativo; sus marcas duran mientras la página esté abierta. Estos datos originales no se actualizaron como parte de la consulta de hojas de vida.
