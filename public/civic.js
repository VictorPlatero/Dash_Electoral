const $ = id => document.getElementById(id);

function element(tag, content, doc = document) {
  const node = doc.createElement(tag);
  if (content) node.textContent = content;
  return node;
}

function link(label, url, doc = document) {
  const node = element('a', label, doc);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

async function getJson(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error('No se pudo cargar ' + name);
  return response.json();
}

let civicData;
function loadCivic() {
  civicData ??= getJson('civic.json').catch(error => {
    civicData = undefined;
    throw error;
  });
  return civicData;
}

const formatDate = (value, time = false) => new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  ...(time ? {timeStyle: 'short', timeZone: 'America/Lima'} : {timeZone: 'UTC'})
}).format(new Date(value));
const number = new Intl.NumberFormat('es-PE', {maximumFractionDigits: 3});
const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

function sourceList(sources, doc = document) {
  const list = element('ul', '', doc);
  for (const {label, url} of sources) {
    const item = element('li', '', doc);
    item.append(link(label, url, doc));
    list.append(item);
  }
  return list;
}

function recordCard(record, showCandidate = true) {
  const item = element('article');
  item.className = 'civic-record';
  item.append(
    element('h4', record.title),
    element('p', [showCandidate ? record.candidate : '', record.topic, formatDate(record.date)].filter(Boolean).join(' · ')),
    element('strong', record.status)
  );
  if (record.summary) item.append(element('p', record.summary));
  item.append(sourceList(record.sources));
  if (record.evidence) {
    item.append(element('p', record.evidence.length ? 'Evidencia de avance' : 'Aún no se ha incorporado evidencia de avance para esta propuesta.'));
    if (record.evidence.length) item.append(sourceList(record.evidence));
  }
  return item;
}

function renderRecords(container, records, empty, showCandidate = true) {
  container.replaceChildren(...(records.length
    ? records.map(record => recordCard(record, showCandidate))
    : [element('p', empty)]));
}

export async function addCandidateCivic(container, candidateId) {
  const section = element('section');
  section.className = 'panel civic-card';
  const content = element('div');
  const status = element('p', 'Cargando registros…');
  status.role = 'status';
  content.append(status);
  section.append(element('h3', 'Compromisos y controversias documentadas'), content);
  container.append(section);
  try {
    const data = await loadCivic();
    const records = [...data.commitments, ...data.cases].filter(record => record.candidateId === candidateId);
    renderRecords(content, records, 'El catálogo todavía no contiene registros revisados para esta candidatura.', false);
  } catch {
    status.textContent = 'No se pudieron cargar los registros. Vuelve a abrir la ficha para reintentar.';
  }
}

function renderIssue(target, issue, district, municipality, data) {
  const local = issue.kind === 'municipal';
  const contact = municipality ?? {label: 'Consultar el directorio municipal de Tacna (Congreso)', url: data.municipalDirectory};
  target.replaceChildren(
    element('h4', local ? (municipality?.label.startsWith('Municipalidad') ? municipality.label : 'Municipalidad Distrital de ' + district.name) : issue.entity),
    element('p', issue.guidance),
    element('p', 'Ten a mano: ' + issue.prepare),
    sourceList(local ? [contact, issue.source] : [issue.source])
  );
}

function contactFor(data, district, province, directory) {
  const portal = data.municipalities[district.code];
  const provincial = directory.provinces.find(item => item.name === province.name);
  const isCapital = district.name === province.name || district.code === '220301';
  if (isCapital && provincial) return {label: provincial.entity, url: provincial.portal};
  if (portal) return {label: 'Portal municipal de ' + district.name, url: portal};
  return null;
}

function reportSection(doc, title, report) {
  const section = element('section', '', doc);
  section.append(element('h2', title, doc));
  if (!report) {
    section.append(element('p', 'El catálogo no tiene un reporte electoral validado para este ámbito.', doc));
    return section;
  }
  const cutoff = report.reportedAt ? formatDate(report.reportedAt, true) + ' (hora de Lima)' : 'Fecha de corte no verificada';
  section.append(element('p', cutoff + ' · ' + report.sourceName, doc));
  if (report.progress != null) section.append(element('p', 'Avance de actas: ' + number.format(report.progress) + ' %', doc));
  const list = element('ul', '', doc);
  for (const party of report.parties) {
    const percent = party.percent == null ? 'Porcentaje no disponible' : number.format(party.percent) + ' %';
    const votes = party.votes == null ? '' : ' · ' + number.format(party.votes) + ' votos';
    list.append(element('li', party.name + ' — ' + percent + votes, doc));
  }
  section.append(list, link('Abrir el reporte de la fuente', report.sourceUrl, doc));
  return section;
}

function downloadDistrict(data, territory, district, province, municipality) {
  const title = 'Ficha del distrito de ' + district.name;
  const doc = document.implementation.createHTMLDocument(title);
  doc.documentElement.lang = 'es';
  const charset = element('meta', '', doc);
  charset.setAttribute('charset', 'utf-8');
  doc.head.prepend(charset);
  const viewport = element('meta', '', doc);
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  doc.head.append(viewport, element('style', 'body{max-width:48rem;margin:2rem auto;padding:0 1rem;font:1rem/1.55 system-ui;color:#17354c}section{border-top:1px solid #cad6df;margin-top:1.5rem}a{color:#164f80}@media print{body{margin:0}h2{break-after:avoid}}', doc));
  doc.body.append(
    element('p', 'Tacna Decide · Ficha ciudadana', doc),
    element('h1', title, doc),
    element('p', 'Provincia de ' + province.name + ' · Departamento de Tacna · UBIGEO INEI ' + district.ineiCode, doc),
    reportSection(doc, 'Resultados distritales', territory.reports.find(report => report.zoneCode === district.code && report.zoneLevel === 'district')),
    reportSection(doc, 'Resultados provinciales · ' + province.name, territory.reports.find(report => report.zoneCode === province.code && report.zoneLevel === 'province')),
    element('p', 'Los resultados de cada sección corresponden a su propio ámbito. Para resultados oficiales, consulta ONPE.', doc),
    link('Consultar ONPE', 'https://erm2026.onpe.gob.pe/', doc),
    element('h2', 'Atención municipal', doc),
    sourceList([municipality ?? {label: 'Consultar el directorio municipal de Tacna (Congreso)', url: data.municipalDirectory}], doc),
    element('h2', 'Canales para reportar problemas de servicios', doc),
    sourceList(data.issues.filter(issue => !issue.kind).map(issue => issue.source), doc)
  );
  const url = URL.createObjectURL(new Blob(['<!doctype html>', doc.documentElement.outerHTML], {type: 'text/html;charset=utf-8'}));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = 'ficha-distrito-' + district.ineiCode + '.html';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function setupDistricts(data, territory, directory) {
  const provinceSelect = $('civic-province');
  const districtSelect = $('civic-district');
  const issueSelect = $('civic-issue');
  const places = territory.geography.features.map(feature => feature.properties);
  const provinces = places.filter(place => place.level === 'province').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const districts = places.filter(place => place.level === 'district').sort((a, b) => a.name.localeCompare(b.name, 'es'));
  provinceSelect.replaceChildren(...provinces.map(place => new Option(place.name, place.code)));
  provinceSelect.value = '220100';
  issueSelect.replaceChildren(...data.issues.map(issue => new Option(issue.title, issue.id)));

  function selectedPlaces() {
    const province = provinces.find(place => place.code === provinceSelect.value);
    const district = districts.find(place => place.code === districtSelect.value);
    return {province, district, municipality: contactFor(data, district, province, directory)};
  }

  function update() {
    const {district, municipality} = selectedPlaces();
    const hasReport = territory.reports.some(report => report.zoneCode === district.code && report.zoneLevel === 'district');
    $('civic-district-note').textContent = hasReport
      ? 'La ficha incluye el reporte distrital disponible y el contexto provincial.'
      : 'La ficha identifica la falta de un reporte distrital y muestra por separado el reporte provincial disponible.';
    renderIssue($('civic-routing'), data.issues.find(issue => issue.id === issueSelect.value), district, municipality, data);
  }

  function updateDistricts() {
    districtSelect.replaceChildren(...districts.filter(place => place.provinceCode === provinceSelect.value)
      .map(place => new Option(place.name, place.code)));
    if (provinceSelect.value === '220100') districtSelect.value = '220101';
    update();
  }

  provinceSelect.addEventListener('change', updateDistricts);
  districtSelect.addEventListener('change', update);
  issueSelect.addEventListener('change', update);
  $('civic-download').addEventListener('click', () => {
    const {district, province, municipality} = selectedPlaces();
    downloadDistrict(data, territory, district, province, municipality);
  });
  updateDistricts();
}

async function initialize() {
  try {
    const data = await loadCivic();
    $('civic-review').textContent = 'Catálogo revisado el ' + formatDate(data.reviewedAt) + '.';
    const search = $('civic-search');
    function filter() {
      const term = normalize(search.value);
      for (const [key, id] of [['commitments', 'civic-commitments'], ['cases', 'civic-cases']]) {
        const records = data[key].filter(record => normalize([record.candidate, record.title, record.topic, record.status].join(' ')).includes(term));
        renderRecords($(id), records, 'No se encontraron registros para esa búsqueda.');
      }
    }
    search.addEventListener('input', filter);
    filter();
    $('civic-record-controls').hidden = false;
  } catch {
    $('civic-review').textContent = 'No se pudo cargar el catálogo de compromisos y controversias.';
  }
  try {
    const [data, territory, directory] = await Promise.all([loadCivic(), getJson('territorial.json'), getJson('citizen.json')]);
    setupDistricts(data, territory, directory);
    $('civic-district-controls').hidden = false;
    $('civic-district-status').textContent = '';
  } catch {
    $('civic-district-status').textContent = 'No se pudieron cargar los distritos. Recarga la página para reintentar.';
  }
}

let initialization;

export function initCivic() {
  initialization ??= initialize();
  return initialization;
}
