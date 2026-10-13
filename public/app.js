let data;
let selected = 'municipal';
let citizen;
let candidatesModule;
let citizenLoading = false;
const colors = ['#ffad32', '#184a6a', '#2c6280', '#63899f', '#9fb7c6'];
const $ = (id) => document.getElementById(id);
const number = (value, digits = 3) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(value);
const source = (id) => data.sources.find((item) => item.id === id);
function renderElection() {
  const election = data[selected];
  document.querySelectorAll('[data-election]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.election === selected)));
  $('leader-percent').textContent = number(election.parties[0].percent) + '%';
  $('leader-name').textContent = election.parties[0].name;
  $('gap').textContent = number(election.parties[0].percent - election.parties[1].percent) + ' pp';
  $('scope-short').textContent = selected === 'municipal' ? 'Provincia' : 'Región';
  $('scope').textContent = election.scope;
  $('scope-note').textContent = selected === 'municipal' ? 'Alcaldía provincial de Tacna' : 'Gobernación del departamento';
  $('chart-subtitle').textContent = election.title + ' · ' + election.scope;
  $('bar-chart').setAttribute('aria-label', election.parties.map(p => p.name + ': ' + number(p.percent) + '%').join('; '));
  $('bar-chart').replaceChildren();
  $('compact-ranking').replaceChildren();
  $('results-body').replaceChildren();
  election.parties.forEach((party, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar-row';
    bar.innerHTML = '<span class="bar-label"></span><div class="bar-track"><div class="bar-fill"></div></div><span class="bar-value"></span>';
    bar.querySelector('.bar-label').textContent = party.short;
    bar.querySelector('.bar-label').title = party.name;
    bar.querySelector('.bar-fill').style.width = (party.percent / 40 * 100) + '%';
    bar.querySelector('.bar-fill').style.backgroundColor = colors[i];
    bar.querySelector('.bar-value').textContent = number(party.percent) + '%';
    $('bar-chart').append(bar);
    const rank = document.createElement('div');
    rank.className = 'rank-row';
    rank.innerHTML = '<span class="rank-number"></span><span class="rank-name"></span><span class="rank-percent"></span>';
    rank.children[0].textContent = String(i + 1).padStart(2, '0');
    rank.children[1].textContent = party.name;
    rank.children[2].textContent = number(party.percent) + '%';
    $('compact-ranking').append(rank);
    const tr = document.createElement('tr');
    for (const value of [String(i + 1).padStart(2, '0'), party.name, number(party.percent) + '%']) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const status = document.createElement('td');
    status.innerHTML = '<span class="table-status">Parcial</span>';
    tr.append(status); $('results-body').append(tr);
  });
  $('progress').textContent = number(election.reportedProgress) + '%';
  $('donut').style.background = `conic-gradient(var(--navy) 0 ${election.reportedProgress}%, var(--amber) ${election.reportedProgress}% 100%)`;
  $('cutoff').textContent = election.cutoff;
  $('report-link').href = source(election.source).url;
  $('results-title').textContent = election.title + ' · Tacna';
  $('results-cutoff').textContent = 'Reporte parcial de El Comercio · Corte: ' + election.cutoff;
}
function navigate() {
  const allowed = ['resumen', 'resultados', 'candidatos', 'contexto', 'fuentes', 'vecinos', 'province-select'];
  const id = allowed.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'resumen';
  const viewId = id === 'province-select' ? 'vecinos' : id;
  document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== viewId);
  document.querySelector('.toolbar').hidden = !['resumen', 'resultados'].includes(viewId);
  document.querySelectorAll('[data-view]').forEach(link => {
    const active = link.dataset.view === viewId;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('page-title').textContent = { resumen: 'Dashboard electoral', resultados: 'Resultados parciales', candidatos: 'Candidatos y hojas de vida', contexto: 'Contexto de Tacna', fuentes: 'Información verificable', vecinos: 'Servicios para vecinos' }[viewId];
  document.querySelector('.edition').textContent = viewId === 'candidatos' ? 'Hojas de vida: ' + ($('candidatos').dataset.consultedAt || 'Consultando…') : 'Resultados y directorio: 06 oct 2026';
  if (viewId === 'candidatos') {
    candidatesModule ||= import('./candidates.js').then(module => module.init()).catch(() => { $('candidate-status').textContent = 'No se pudieron cargar las fichas. Recarga la página para reintentar.'; candidatesModule = null; });
  }
  if (viewId === 'vecinos') loadCitizen();
  $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false');
  if (id === 'province-select') $('province-select').focus();
}
function renderSources() {
  for (const item of data.sources) {
    const card = document.createElement('article'); card.className = 'panel';
    card.innerHTML = '<span class="source-type"></span><h2></h2><p></p><a class="text-link" target="_blank" rel="noopener noreferrer">Abrir fuente ↗</a>';
    card.children[0].textContent = item.type;
    card.children[1].textContent = item.name;
    card.children[2].textContent = item.note;
    card.children[3].href = item.url;
    $('source-list').append(card);
  }
  for (const id of ['governor', 'mayor', 'reniec']) $(id + '-link').href = source(id).url;
}
function renderCalendar() {
  const calendar = document.querySelector('.calendar');
  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(day => {
    const cell = document.createElement('span'); cell.className = 'weekday'; cell.textContent = day; calendar.append(cell);
  });
  for (let i = 0; i < 3; i++) calendar.append(document.createElement('span'));
  for (let day = 1; day <= 31; day++) {
    const cell = document.createElement('span'); cell.textContent = day;
    if (day === 4) { cell.className = 'election'; cell.title = 'Jornada electoral'; }
    if (day === 6) { cell.className = 'research'; cell.title = 'Consulta de fuentes'; }
    calendar.append(cell);
  }
}
function exportCSV() {
  const e = data[selected];
  const rows = [['cargo', 'ambito', 'organizacion', 'porcentaje_reportado', 'avance_reportado', 'corte', 'fuente', 'estado'], ...e.parties.map(p => [e.title, e.scope, p.name, p.percent, e.reportedProgress, e.cutoff, source(e.source).url, 'Parcial; fuente periodística; sin actualización en vivo'])];
  const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `tacna-${selected}-2026.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelectorAll('[data-election]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.election; if (data) renderElection(); }));
$('menu').addEventListener('click', () => { const open = $('sidebar').classList.toggle('open'); $('menu').setAttribute('aria-expanded', String(open)); });
document.querySelectorAll('[data-view]').forEach(link => link.addEventListener('click', () => { $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false'); }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('click', event => { if (!event.target.closest('#sidebar') && !event.target.closest('#menu')) { $('sidebar').classList.remove('open'); $('menu').setAttribute('aria-expanded', 'false'); } });
$('export').addEventListener('click', exportCSV);
window.addEventListener('hashchange', navigate);
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderServices() {
  if (!citizen) return;
  const query = normalize($('service-search').value.trim());
  const topic = $('service-topic').value;
  const filtered = citizen.services.filter(item => (topic === 'all' || topic === item.category) && normalize(item.title + ' ' + item.description + ' ' + item.keywords).includes(query));
  $('service-count').textContent = filtered.length ? `${filtered.length} ${filtered.length === 1 ? 'servicio disponible' : 'servicios disponibles'}` : 'No se encontraron servicios. Prueba otra palabra o limpia los filtros.';
  $('service-cards').replaceChildren();
  filtered.forEach(item => {
    const card = document.createElement('article'); card.className = 'panel service-card';
    const agency = document.createElement('span'); agency.className = 'eyebrow'; agency.textContent = item.agency;
    const title = document.createElement('h2'); title.textContent = item.title;
    const description = document.createElement('p'); description.textContent = item.description;
    const link = document.createElement('a'); link.className = 'button outline'; link.textContent = item.action + (item.url.startsWith('https:') ? ' ↗' : ''); link.href = item.url;
    if (item.url.startsWith('https:')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    card.append(agency, title, description, link); $('service-cards').append(card);
  });
}
function renderProvince() {
  if (!citizen) return;
  const province = citizen.provinces.find(item => item.name === $('province-select').value);
  const card = $('province-card'); card.replaceChildren();
  const title = document.createElement('h3'); title.textContent = province.entity; card.append(title);
  for (const value of [province.address, province.hours]) { const p = document.createElement('p'); p.textContent = value; card.append(p); }
  const phones = document.createElement('div'); phones.className = 'phone-list';
  province.phones.forEach(phone => { const a = document.createElement('a'); a.href = 'tel:' + phone.dial; a.textContent = 'Llamar: ' + phone.display; phones.append(a); });
  if (!province.phones.length) { const p = document.createElement('p'); p.textContent = 'Sin teléfono verificado en este directorio.'; phones.append(p); }
  card.append(phones);
  for (const [url, label] of [[province.portal, 'Trámites y portal municipal'], [province.source, 'Fuente del directorio']]) { const a = document.createElement('a'); a.className = 'text-link directory-link'; a.href = url; a.textContent = label + ' ↗'; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); }
}
$('service-search').addEventListener('input', renderServices);
$('service-topic').addEventListener('change', renderServices);
$('clear-services').addEventListener('click', () => { $('service-search').value = ''; $('service-topic').value = 'all'; renderServices(); $('service-search').focus(); });
$('province-select').addEventListener('change', renderProvince);
document.querySelectorAll('.checklist input').forEach(input => input.addEventListener('change', () => { $('checklist-progress').textContent = `${document.querySelectorAll('.checklist input:checked').length} de 4 pasos revisados`; }));
$('print-guide').addEventListener('click', () => window.print());
try { if (localStorage.getItem('tacna-reading') === 'large') { document.body.classList.add('large-reading'); $('reading-toggle').setAttribute('aria-pressed', 'true'); } } catch {}
$('reading-toggle').addEventListener('click', () => { const expanded = document.body.classList.toggle('large-reading'); $('reading-toggle').setAttribute('aria-pressed', String(expanded)); try { localStorage.setItem('tacna-reading', expanded ? 'large' : 'normal'); } catch {} });
function loadCitizen() {
if (citizen || citizenLoading) return;
citizenLoading = true;
fetch('citizen.json').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(result => {
  citizen = result; renderServices(); renderProvince();
}).catch(() => { citizenLoading = false; $('service-count').textContent = 'No se pudo cargar el directorio. Cambia de sección y vuelve a intentarlo.'; });
}
fetch('data.json').then(response => { if (!response.ok) throw new Error('Datos no disponibles'); return response.json(); }).then(result => {
  data = result; renderElection(); renderSources(); renderCalendar(); navigate(); $('loading').hidden = true; $('dashboard').hidden = false;
}).catch(() => { $('loading').textContent = 'No se pudo cargar la información. Recarga la página o revisa que data.json esté publicado junto al dashboard.'; });
