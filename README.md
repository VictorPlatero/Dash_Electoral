# Tacna Decide — resultados y hojas de vida

Dashboard en español de las elecciones regionales y municipales de Tacna. Incluye una base SQLite dentro de la carpeta del proyecto, 21 fotografías oficiales del catálogo, descripciones de hojas de vida, porcentajes reportados por lista, indicadores de inteligencia de negocios, comparación de hasta tres candidatos al mismo cargo y ámbito y un mapa electoral interactivo.

Funciona tanto como **Render Static Site** (catálogo público de consulta) como **Web Service Node** (SQLite y edición centralizada). El sitio estático carga sus JSON publicados; no depende de endpoints `/api` que no existen en ese tipo de alojamiento. Los botones de perfiles, detalles, análisis, comparación, fotos, filtros y descargas funcionan en ambas modalidades.

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

Para reproducir un despliegue estático antes de subirlo:

```sh
npm run build
npm run preview:static
```

O `node scripts/serve-static.mjs`; abre http://127.0.0.1:4174/#candidatos. Los enlaces `#perfiles` y `#analisis` admiten entrada directa, recarga y navegación con el historial. `public/runtime.json` identifica el catálogo estático; el servidor Node responde a esa misma ruta con su modalidad de API. Si un despliegue antiguo devuelve 404 o HTML en lugar de JSON para la API, el cliente carga el catálogo publicado.

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

## Resultados detallados

La sección `#resultados` ofrece seis indicadores: primera lista, brecha entre primera y segunda, concentración de las dos primeras, votos válidos, avance de actas y cantidad de organizaciones del reporte. La lectura automática resume la primera posición y la concentración de las tres primeras, siempre dentro del cargo, ámbito y corte seleccionados.

Incluye ranking con fotos y enlaces JNE cuando están disponibles, anillo de distribución, comparación interactiva de dos listas, diagrama de organizaciones presentes en alcaldía y gobierno regional, curva de concentración acumulada y distribución de votos válidos respecto de votos emitidos. Las barras utilizan una escala común de 0–100%; no se renormalizan los porcentajes de los listados incompletos. Los nombres largos del comparador se abrevian solo en la etiqueta del dibujo; los selectores y textos accesibles conservan su nombre completo.

El selector de fuente separa **Andina / ONPE** (el snapshot territorial con cuatro elecciones provinciales y el total regional) de **El Comercio** (las cinco organizaciones del corte del 6 de octubre, Tacna provincial o departamento). No se completan los votos del reporte periodístico con cantidades de otra fecha. Los reportes territoriales conservan sus propias fechas, incluidas las omisiones del resumen incompatible de Candarave. Si el snapshot territorial no carga, se mantiene disponible el corte periodístico y un botón de reintento.

La tabla detalla posición, organización, candidatura vinculada, porcentaje, votos, diferencia con la primera, diferencia con la fila anterior y acumulado. Las brechas se expresan en puntos porcentuales. Las sumas pueden diferir ligeramente del 100% por redondeo. La descarga CSV exporta el reporte seleccionado completo, con ámbito, corte, consulta y fuente; los cálculos derivados se redondean a tres decimales y los datos pendientes permanecen vacíos.

Los votos válidos y los emitidos usan denominadores distintos. El resto de los emitidos no se divide entre blancos y nulos sin un desglose compatible. El avance de actas no es participación: no se calcula una tasa de participación con el padrón contradictorio. La comparación entre cargos muestra porcentajes de elecciones y ámbitos diferentes, con sus cortes y fuentes, sin sumarlos ni inferir transferencias de votos. La metodología de cada indicador está disponible en la propia sección.

## Mapa electoral interactivo

La sección `#mapa` permite seleccionar las **4 provincias y los 28 distritos**, incluyendo La Yarada Los Palos, mediante polígonos o un selector por nombre. Tiene zoom, desplazamiento, selección por teclado, filtros por cargo, organización y candidatura, detalle de votos y porcentajes, enlaces a las fuentes y descarga CSV de las zonas visibles. Funciona en móvil y en Render Static Site sin una API propia, claves ni servicios de mapas externos en tiempo de ejecución.

El archivo publicado `public/territorial.json` contiene geometría referencial y reportes consultados el **13 de octubre de 2026** en el [visor electoral de Andina](https://andina.pe/agencia/embedresultadosmunicipales2026.aspx?dep=220000&nivel=provincial&widget=1), que atribuye sus datos a ONPE. La [geometría distribuida por Andina](https://andina.pe/agencia/js/geo/onpe_indice.json) incluye los 28 distritos; el servicio MINAM consultado conserva 27. Se mantienen separados los códigos ONPE e INEI, cuya numeración de provincias difiere. Los polígonos se simplifican para navegación y no certifican límites legales.

La consulta permitió validar **cinco reportes**: las cuatro alcaldías provinciales y el total del gobierno regional. No devolvió un desglose validable de apoyo distrital ni de votación regional por provincia. Las zonas sin datos se rayan; no se les asigna cero ni el porcentaje de su provincia o departamento. El indicador de mayor apoyo de un candidato requiere al menos dos zonas de su misma elección, nivel y fecha de corte; con este catálogo señala que falta un desglose comparable.

Cada provincia elige candidatos distintos. El filtro de organización puede mostrar listas diferentes del mismo partido; el filtro de candidatura respeta su ámbito. Se añadieron fotos y enlaces JNE de las listas encabezantes de Candarave, Tarata y Jorge Basadre, además del catálogo de Tacna. No se atribuye a un candidato de Tacna el porcentaje de otra persona del mismo partido.

Los reportes provinciales de Tacna, Tarata y Jorge Basadre indican corte **5 de octubre, 10:46 a. m. de Lima**. El regional conserva la fecha indicada por su propia fuente. En Candarave, el resumen de actas tiene un total distinto al listado: se mantienen los votos y porcentajes coherentes del listado y se omiten fecha y avance del resumen incompatible. Estos cortes permanecen separados de los resultados del 6 de octubre de la vista general y de las fichas; no se mezclan como si fueran la misma actualización.

Para actualizar geometría, resultados y fotos de las listas encabezantes:

```sh
npm run sync:map
npm test
npm run build
```

Equivalente: `node scripts/sync-map.mjs`. Usa tres consultas simultáneas, pausas, tiempo máximo, reintentos y validación de ámbito, votos y porcentajes. Solo reemplaza el JSON al completar la sincronización. `node scripts/sync-map.mjs --resume` reutiliza respuestas de menos de 24 horas guardadas en `research/`; omite esa opción para consultar de nuevo. El snapshot territorial se versiona en Git y se publica junto con el frontend.

## Importar y mantener la base

En Candidatos, abre **Importar fichas**. Descarga un ejemplo de estructura (contiene una ficha real), edítalo y carga el JSON o pégalo. La vista previa permite revisar nombres y cargo; el servidor valida todos los campos antes de guardar el lote en una transacción. Un ID existente actualiza la ficha; otro ID agrega un registro. Incluye siempre una fuente HTTPS y una fecha de consulta válida. No importa directamente PDF o imágenes: la extracción oficial se realiza mediante el script JNE y los datos manuales se importan en JSON.

La importación está disponible cuando se ejecuta el servidor SQLite. En Render Static Site se consulta el catálogo publicado y se puede descargar CSV o respaldo JSON; el botón de edición centralizada no aparece. Para publicar nuevos datos en ese modo, actualiza `public/candidates.json` mediante la sincronización o el catálogo exportado, valida con las pruebas y realiza build/push. La base SQLite local sigue dentro de `storage/`; no se simula una base compartida en un alojamiento estático.

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
- Módulos de candidatos, resultados detallados, directorio ciudadano y mapa cargados al entrar en su sección. Los gráficos de resultados y el mapa utilizan SVG/CSS; el snapshot territorial ocupa unos 216 KB, sin librerías ni peticiones a proveedores externos al navegar.
- Búsqueda con debounce, cancelación de consultas anteriores y paginación (8 fichas por página).
- SQLite con WAL, claves foráneas, índices por cargo/organización/ámbito y nombre, consultas parametrizadas y unión a hechos electorales; migración automática de la base previa sin eliminar fichas.
- Caché de archivos en memoria, gzip para texto y revalidación ETag/304. Las fotos tienen carga diferida y hash de contenido; las 21 fotografías suman unos 553 KB.
- Tipografías del sistema, sin solicitudes externas a Google Fonts. Diseño adaptable, navegación por teclado, diálogos nativos y preferencia A+ persistida en el navegador.
- API con validación de lotes, límite de 2 MB y 500 fichas por importación, control de origen, clave administrativa en producción y cabeceras de seguridad. Datos de usuario se renderizan con `textContent`.

## Pruebas

```sh
npm test
```

O `node --test`. Las pruebas funcionales cubren solapamiento de experiencia, datos ausentes, absoluciones, ámbito y mapeo JNE, integridad y fuente de las 21 fotos, descripciones, vinculación de porcentajes, denominadores BI, mediana por año, migración SQLite, anotaciones, validación, persistencia, autorización, filtros, paginación, respaldo, CSV y caché HTTP.

La suite completa tiene **34 pruebas**, incluyendo la regresión del despliegue estático sin API, equivalencia de filtros/gráficos/CSV entre SQLite y catálogo, recuperación ante 404 o rewrite HTML, reintento de cargas fallidas y arranque de producción con `PORT`, host `0.0.0.0` y una ruta configurable de base de datos. Las ocho pruebas del mapa verifican provincias y distritos, correspondencia de códigos, compatibilidad de ámbito y fecha, denominadores, ausencia de porcentajes inventados, metadatos incompatibles, geometría SVG, fuentes y fotos JNE, y exportación de valores ausentes. Las seis pruebas de resultados cubren separación de fuentes y cortes, denominadores, brechas, acumulados, comparación de listas y cargos, recuperación sin snapshot y CSV completo con valores nulos y precisión decimal. El build valida las fichas y genera `dist/build-info.json` con versión, huella de los archivos y cantidad de candidatos para verificar qué versión está desplegada.

## Render

`render.yaml` configura un **Static Site**, compatible con `https://dash-electoral.onrender.com`. Build: `npm run build`. Publish Directory: `dist`. No requiere Start Command ni base de datos remota para consultar las fichas, abrir perfiles, comparar, analizar o exportar. Mantiene la configuración del alojamiento existente y no requiere crear un servicio de pago. Los cambios se publican con el autodeploy del repositorio conectado.

Si necesitas edición centralizada y SQLite en Render, **`render-backend.yaml`** conserva el Blueprint opcional de Web Service Node: build `npm run build`, start `npm start`, health check `/api/health`, disco en `/var/data`, `DATABASE_PATH=/var/data/candidates.sqlite` y clave `ADMIN_TOKEN`. Esta opción usa Starter y un disco de 1 GB, ambos de pago; no se creó ni compró ese servicio. En Render, Node utiliza automáticamente `PORT` y `0.0.0.0`, incluso si `HOST` no está definido. [Static Sites](https://render.com/docs/static-sites), [Web Services](https://render.com/docs/web-services), [discos persistentes](https://render.com/docs/disks).

## API

Estas rutas corresponden al **servidor Node**, no al Static Site. El frontend adapta su fuente de datos automáticamente; las descargas estáticas se generan en el navegador.

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
