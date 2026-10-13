# Tacna Decide — resultados y hojas de vida

Dashboard en español de las elecciones regionales y municipales de Tacna. Incluye una base SQLite dentro de la carpeta del proyecto, 21 fotografías oficiales, descripciones de hojas de vida, porcentajes reportados por lista, indicadores de inteligencia de negocios y comparación de hasta tres candidatos al mismo cargo y ámbito.

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

Las **21 fotografías oficiales** se descargaron del almacenamiento de imágenes utilizado por Voto Informado, según el campo `urlFoto` de cada DJHV. Se conservan sin editar en `public/portraits/`, con nombres derivados del identificador de ficha y un hash del contenido, sin usar DNI como nombre. Cada ficha conserva atribución, fecha y enlace a su página del JNE. La web carga las imágenes locales de forma diferida, con tamaño reservado y texto alternativo.

Los porcentajes se revisaron el **13 de octubre de 2026** en las notas de [alcaldía provincial](https://elcomercio.pe/elecciones/elecciones-regionales-y-municipales-2026-resultados-oficiales-de-onpe-en-la-provincia-de-tacna-tacna-noticia/) y [gobierno regional](https://elcomercio.pe/elecciones/elecciones-regionales-y-municipales-2026-resultados-oficiales-de-onpe-en-la-region-de-tacna-noticia/) de El Comercio. Ambas publican cinco organizaciones, con corte **6 de octubre, 12:46**, y atribuyen el cómputo a ONPE. El portal de resultados de ONPE no devolvió información accesible en la consulta; no se presenta el dato como una verificación directa de actas.

La vinculación se hace por **cargo, organización y ámbito**, normalizando tildes y separadores. Hay **9 fichas con porcentaje publicado** (4 municipales y 5 regionales) y **12 con porcentaje no disponible**. La quinta organización municipal publicada no tiene una DJHV del titular disponible en la consulta JNE. No se inventan porcentajes del resto ni se redistribuye el remanente. La posición es la de la organización en el reporte parcial, no una proclamación ni un porcentaje de participación.

## Análisis y comparación

- Búsqueda sin distinción de tildes por nombre, partido y formación; filtros por cargo, organización y disponibilidad de porcentaje; paginación y orden por porcentaje dentro de cada cargo, nombre o consulta.
- Foto y descripción en cada tarjeta, detalle y comparación. La descripción resume estudios, empleo reciente y cargos electivos de la DJHV; no acredita títulos ni añade valoraciones.
- Nivel de formación declarado y estado de conclusión de cada estudio. Un posgrado declarado no acredita automáticamente un grado de maestro o doctor.
- Años de experiencia con resolución anual: se resta inicio a término, se unen los períodos superpuestos y se limita el cálculo a 2026. Un empleo del mismo año aporta cero años medibles; fechas incompletas quedan excluidas y generan una aclaración.
- Registros penales y de obligaciones se muestran con su materia, fallo, expediente y fuente. Una absolución se distingue explícitamente; contar registros no determina condenas ni antecedentes.
- Cobertura de cinco secciones: formación, experiencia, trayectoria, declaraciones judiciales y finanzas. Mide revisión documental, no mérito ni calidad del candidato. Una sección pendiente conserva valores nulos, no cero.
- Comparador de hasta tres fichas del mismo cargo y ámbito. No usa puntajes ni recomienda un voto. Las anotaciones marginales se muestran como texto con el contenido original y la corrección; no se aplican automáticamente a otros campos.
- CSV con todas las coincidencias del filtro, aunque la pantalla esté paginada; protege las celdas que podrían interpretarse como fórmulas.

## Inteligencia de negocios

Los indicadores y gráficos responden a los filtros de candidatos y utilizan **todas las coincidencias**, independientemente de la página visible:

- Cantidad de candidaturas y cobertura de resultados (`fichas con porcentaje / fichas del filtro`). Una cobertura de resultados del 42,9% no es un porcentaje de votación.
- Experiencia media entre las fichas con sección laboral revisada, conservando cero cuando está declarado y excluyendo valores pendientes.
- Mediana de ingresos brutos por **año declarado**, con el número de declaraciones usado. Si hay varios años, el indicador principal utiliza el más reciente; no combina ingresos de años distintos.
- Ranking visual de porcentajes por cargo, con fuente y corte. Se puede abrir una ficha desde cada barra.
- Distribución porcentual del nivel educativo declarado, con denominador de fichas revisadas y estado de conclusión en el detalle.
- Dispersión de experiencia laboral y votación publicada para **un cargo a la vez**; cada punto permite abrir su hoja de vida. No se estima una relación causal ni una tendencia con datos incompletos.

La carga JNE funciona como ETL: extracción de listas y DJHV, validación del ámbito, normalización de campos y carga transaccional. La base relaciona las fichas y sus dimensiones de formación, experiencia y registros judiciales con la tabla de hechos `electoral_reports` (cargo, organización, ámbito, porcentaje y metadatos de fuente). Los porcentajes se importan desde `public/data.json` al iniciar el servidor; no son editables por el importador de hojas de vida. El CSV incluye foto, descripción, porcentaje, posición, corte y fuente para continuar el análisis tabular.

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
- SQLite con WAL, claves foráneas, índices por cargo/organización/ámbito y nombre, consultas parametrizadas y unión a hechos electorales; migración automática de la base previa sin eliminar fichas.
- Caché de archivos en memoria, gzip para texto y revalidación ETag/304. Las fotos tienen carga diferida y hash de contenido; las 21 fotografías suman unos 553 KB.
- Tipografías del sistema, sin solicitudes externas a Google Fonts. Diseño adaptable, navegación por teclado, diálogos nativos y preferencia A+ persistida en el navegador.
- API con validación de lotes, límite de 2 MB y 500 fichas por importación, control de origen, clave administrativa en producción y cabeceras de seguridad. Datos de usuario se renderizan con `textContent`.

## Pruebas

```sh
npm test
```

O `node --test`. Las 15 pruebas cubren solapamiento de experiencia, datos ausentes, absoluciones, ámbito y mapeo JNE, integridad y fuente de las 21 fotos, descripciones, vinculación de porcentajes, denominadores BI, mediana por año, migración SQLite, anotaciones, validación, persistencia, autorización, filtros, paginación, respaldo, CSV y caché HTTP.

## Render

`render.yaml` ahora configura un **Web Service Node**, con disco persistente para SQLite, `DATABASE_PATH=/var/data/candidates.sqlite`, `HOST=0.0.0.0` y `ADMIN_TOKEN` generado. Build: `npm run build`. Start: `npm start`. Health check: `/api/health`.

La administración con SQLite requiere un servicio backend; una publicación solo estática no ofrece la API de candidatos. El Blueprint usa el plan Starter y un disco de 1 GB, ambos de pago. Revisa costos antes de desplegar. No se ha creado ningún servicio ni realizado una compra. [Documentación de discos de Render](https://render.com/docs/disks).

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/health` | Estado del servidor |
| GET | `/api/candidates/meta` | Totales, organizaciones, fuente y faltantes |
| GET | `/api/candidates?q=&role=&party=&percentage=&sort=&page=&limit=` | Buscar; límite máximo 50; `sort=votes` ordena por porcentaje dentro del cargo |
| GET | `/api/candidates/analytics?q=&role=&party=&percentage=` | Indicadores y gráficos de todas las coincidencias |
| GET | `/api/candidates/:id` | Hoja de vida y análisis |
| GET | `/api/candidates/export` | CSV de todas las coincidencias |
| GET | `/api/candidates/backup` | Respaldo JSON de todas las fichas |
| POST | `/api/candidates/import` | Lote `{ "candidates": [...] }`; JSON y autorización |

Variables: `PORT` (4173), `HOST` (127.0.0.1), `DATABASE_PATH` y `ADMIN_TOKEN`. La implementación está pensada para una instancia del servidor con SQLite; no comparte la base entre varias instancias.

## Información del proyecto original

El directorio ciudadano conserva su consulta del **6 de octubre de 2026**. Los resultados periodísticos se actualizaron al corte del **6 de octubre**, revisado el 13 de octubre, sin verificación directa de actas. Incluyen cinco organizaciones por cargo, no todas las listas ni una proclamación. El anillo muestra avance del conteo, no participación. Las autoridades 2023–2026 son contexto, no candidaturas inferidas.

La referencia territorial de PCM es de 2021. El padrón RENIEC sigue excluido por la contradicción entre título y cuerpo de la nota. Los contactos no confirmados del directorio permanecen señalados como pendientes; los trámites y consultas personales se abren en páginas oficiales. No se reciben DNI ni solicitudes ciudadanas. El checklist es orientativo; sus marcas duran mientras la página esté abierta. Estos datos originales no se actualizaron como parte de la consulta de hojas de vida.
