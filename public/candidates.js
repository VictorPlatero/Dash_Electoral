import { analyze, roleLabel } from './candidate-model.js';

const $ = id => document.getElementById(id);
const money = value => value == null ? 'No disponible' : new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2 }).format(value);
const date = value => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : 'Sin fecha';
const chosen = new Map(), detailCache = new Map();
let page = 1, listController, timer, preview, lastList, detailRequest = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function link(label, url, className = 'text-link') {
  const node = el('a', className, label); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
}
function button(label, className, action) {
  const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'No se pudo consultar el servidor');
  return body;
}
function params() {
  return new URLSearchParams({ q: $('candidate-search').value.trim(), role: $('candidate-role').value, party: $('candidate-party').value, sort: $('candidate-sort').value, page: String(page), limit: '8' });
}
async function detail(id) {
  if (!detailCache.has(id)) detailCache.set(id, request('/api/candidates/' + encodeURIComponent(id)).catch(error => { detailCache.delete(id); throw error; }));
  return detailCache.get(id);
}

async function overview() {
  const meta = await request('/api/candidates/meta');
  $('candidate-stats').replaceChildren(...[
    [meta.total, 'Fichas consultadas', 'Candidaturas con información disponible'],
    [meta.municipal, 'Alcaldía provincial', 'Provincia de Tacna'],
    [meta.regional, 'Gobierno regional', 'Departamento de Tacna'],
    [meta.reviewed, 'Fichas revisadas', 'Cinco secciones consultadas en la fuente']
  ].map(([value, title, subtitle]) => {
    const card = el('article', 'candidate-stat'); card.append(el('strong', '', value), el('span', '', title), el('small', '', subtitle)); return card;
  }));
  const previous = $('candidate-party').value;
  $('candidate-party').replaceChildren(new Option('Todas las organizaciones', ''), ...meta.parties.map(party => new Option(party, party)));
  if (meta.parties.includes(previous)) $('candidate-party').value = previous;
  $('candidate-status').textContent = `Fuentes del JNE · Última consulta: ${date(meta.latestConsultation)} · Copia fechada`;
  $('candidatos').dataset.consultedAt = date(meta.latestConsultation);
  if (location.hash === '#candidatos') document.querySelector('.edition').textContent = 'Hojas de vida: ' + date(meta.latestConsultation);
  $('candidate-source-note').textContent = `${meta.source.scope || 'Ámbito: Tacna'}. Última consulta de fichas: ${date(meta.latestConsultation)}. Los resultados por partido pertenecen a otro corte y no se usan para puntuar candidatos.`;
  $('candidate-unavailable').replaceChildren();
  if (meta.source.unavailableLists?.length) {
    $('candidate-unavailable').append(el('strong', '', 'Listas sin ficha del titular en la consulta:'));
    const list = el('ul'); meta.source.unavailableLists.forEach(item => list.append(el('li', '', item.party + ': ' + item.note))); $('candidate-unavailable').append(list);
  }
}

function renderCards(items) {
  $('candidate-cards').replaceChildren();
  if (!items.length) {
    const empty = el('div', 'panel candidate-empty');
    empty.append(el('h3', '', 'No encontramos coincidencias'), el('p', '', 'Prueba otro nombre, una profesión o cambia los filtros.'), button('Limpiar filtros', 'button outline', () => { $('candidate-search').value = ''; $('candidate-role').value = ''; $('candidate-party').value = ''; page = 1; loadList(); }));
    $('candidate-cards').append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const candidate of items) {
    const a = candidate.analysis, card = el('article', 'candidate-card panel');
    const heading = el('div', 'candidate-card-heading');
    const initials = candidate.name.split(/\s+/).filter(Boolean).slice(0,2).map(word => word[0]).join('');
    const name = el('div', 'candidate-identity'); name.append(el('span', 'eyebrow', roleLabel(candidate.role)), el('h3', '', candidate.name), el('p', '', candidate.party));
    heading.append(el('span', 'candidate-avatar', initials), name);
    const tags = el('div', 'candidate-tags'); tags.append(el('span', 'candidate-tag', candidate.scope), el('span', 'candidate-tag', candidate.status || 'Estado sin detalle'));
    const metrics = el('dl', 'candidate-metrics');
    for (const [label, value] of [['Formación declarada', a.highest], ['Experiencia sin solapamiento', a.years == null ? 'Pendiente' : `${a.years} ${a.years === 1 ? 'año' : 'años'}`], ['Ingresos anuales declarados', money(a.income)]]) {
      const metric = el('div'); metric.append(el('dt', '', label), el('dd', '', value)); metrics.append(metric);
    }
    const judicial = el('p', 'candidate-judicial', a.legalLabel + (a.acquittals ? ` · ${a.acquittals} absolución(es)` : ''));
    const footer = el('div', 'candidate-card-footer');
    const checkLabel = el('label', 'candidate-compare-label');
    const check = el('input'); check.type = 'checkbox'; check.checked = chosen.has(candidate.id); check.setAttribute('aria-label', 'Comparar a ' + candidate.name);
    check.addEventListener('change', () => {
      if (check.checked) {
        if (chosen.size >= 3) { check.checked = false; $('candidate-count').textContent = 'Puedes comparar hasta tres candidatos a la vez.'; return; }
        const first = chosen.values().next().value;
        if (first && (first.role !== candidate.role || first.scope !== candidate.scope)) { check.checked = false; $('candidate-count').textContent = 'Elige candidatos al mismo cargo y ámbito para compararlos.'; return; }
        chosen.set(candidate.id, candidate);
      } else chosen.delete(candidate.id);
      renderTray();
    });
    checkLabel.append(check, document.createTextNode(' Comparar'));
    footer.append(checkLabel, button('Ver hoja de vida →', 'button candidate-detail-button', () => openDetail(candidate.id)));
    const coverage = el('div', 'candidate-coverage'); coverage.append(el('span', '', `${a.coverage}% de secciones revisadas`), el('small', '', `Consulta: ${date(candidate.source.consultedAt)}`));
    card.append(heading, tags, metrics, judicial, coverage, footer); fragment.append(card);
  }
  $('candidate-cards').append(fragment);
}
async function loadList() {
  listController?.abort(); const controller = new AbortController(); listController = controller;
  $('candidate-cards').setAttribute('aria-busy', 'true');
  $('candidate-count').textContent = 'Buscando fichas…';
  try {
    const result = await request('/api/candidates?' + params(), { signal: controller.signal });
    lastList = result; page = result.page;
    renderCards(result.candidates);
    $('candidate-count').textContent = `${result.total} ${result.total === 1 ? 'candidatura encontrada' : 'candidaturas encontradas'}`;
    $('candidate-page').textContent = `Página ${page} de ${Math.max(1, Math.ceil(result.total / result.limit))}`;
    $('candidate-prev').disabled = page <= 1;
    $('candidate-next').disabled = page * result.limit >= result.total;
    $('candidate-export').href = '/api/candidates/export?' + params();
  } catch (error) {
    if (error.name !== 'AbortError') { $('candidate-count').textContent = error.message; $('candidate-cards').replaceChildren(button('Volver a intentar', 'button outline', loadList)); }
  } finally { if (!controller.signal.aborted) $('candidate-cards').setAttribute('aria-busy', 'false'); }
}
function renderTray() {
  $('comparison-tray').hidden = !chosen.size;
  $('comparison-names').textContent = `${chosen.size}/3 seleccionados · ` + [...chosen.values()].map(c => c.name).join(' / ');
  $('compare-open').disabled = chosen.size < 2;
}
function detailSection(title, entries, empty) {
  const section = el('section', 'detail-section'); section.append(el('h3', '', title));
  if (!entries.length) section.append(el('p', 'detail-empty', empty)); else section.append(...entries);
  return section;
}
function entry(title, lines) {
  const item = el('div', 'detail-entry'); item.append(el('strong', '', title));
  lines.filter(Boolean).forEach(line => item.append(el('p', '', line))); return item;
}
function period(item) { return `${item.startYear ?? 'Sin año inicial'} – ${item.endYear ?? 'Sin año final'}`; }
function renderDetail(c) {
  const a = c.analysis || analyze(c), container = $('candidate-detail'); container.replaceChildren();
  const header = el('header', 'detail-header'), title = el('h2', '', c.name); title.id = 'candidate-dialog-title';
  header.append(el('span', 'eyebrow', roleLabel(c.role) + ' · ' + c.scope), title, el('p', '', c.party), el('span', 'candidate-tag', c.status || 'Estado sin detalle'));
  const source = el('div', 'detail-source'); source.append(link('Ver declaración en el JNE ↗', c.source.url), el('span', '', `Consultada: ${date(c.source.consultedAt)}`));
  if (c.source.pdfUrl) source.append(link('Hoja de vida PDF ↗', c.source.pdfUrl));
  const metrics = el('div', 'detail-summary');
  for (const [label, value] of [['Nivel declarado', a.highest], ['Años sin solapamiento', a.years ?? 'Pendiente'], ['Secciones revisadas', a.coverage + '%']]) {
    const item = el('div'); item.append(el('small', '', label), el('strong', '', value)); metrics.append(item);
  }
  container.append(header, source, metrics);
  if (a.warnings.length) { const warnings = el('div', 'detail-warning'); a.warnings.forEach(warning => warnings.append(el('p', '', warning))); container.append(warnings); }
  const empty = key => c.reviewedSections.includes(key) ? 'La DJHV consultada no registra información en esta sección.' : 'Sección pendiente de revisión; no se interpreta como ausencia de datos.';
  const sections = el('div', 'detail-grid');
  sections.append(detailSection('01 / Formación académica', c.education.map(item => entry(item.degree, [item.institution, `${item.level} · ${item.completed ? 'Concluido según DJHV' : 'Sin conclusión registrada'}${item.year ? ' · Año: ' + item.year : ''}`, item.note])), empty('education')));
  sections.append(detailSection('02 / Experiencia laboral', c.experience.map(item => entry(item.position, [item.organization, period(item)])), empty('experience')));
  sections.append(detailSection('03 / Trayectoria política', c.political.map(item => entry(item.position || item.kind, [item.organization, item.kind + ' · ' + period(item)])), empty('political')));
  sections.append(detailSection('04 / Declaraciones judiciales', c.legal.map(item => entry(item.kind + (item.subject ? ': ' + item.subject : ''), ['Fallo declarado: ' + (item.outcome || 'Sin detalle'), item.court, 'Expediente: ' + (item.caseNumber || 'Sin detalle'), item.date ? 'Fecha: ' + item.date : '', item.note])), empty('legal')));
  const finances = c.finances ? [entry(`Ingresos brutos anuales${c.finances.year ? ' · ' + c.finances.year : ''}`, ['Total: ' + money(c.finances.annualIncome), 'Sector público: ' + money(c.finances.publicIncome), 'Sector privado: ' + money(c.finances.privateIncome), `Bienes inmuebles declarados: ${c.finances.properties ?? 'No disponible'} · Bienes muebles declarados: ${c.finances.vehicles ?? 'No disponible'}`])] : [];
  sections.append(detailSection('05 / Bienes y rentas', finances, empty('finances')));
  sections.append(detailSection('Información adicional y anotaciones', [...c.additional.map(text => entry('Información adicional declarada', [text])), ...c.annotations.map(item => entry('Anotación marginal · ' + item.section, [item.date, 'Dice: ' + item.before, 'Debe decir: ' + item.after]))], 'No registra información adicional ni anotaciones en la fuente consultada.'));
  container.append(sections, el('p', 'detail-disclaimer', 'Información declarada ante el JNE. Los años son una aproximación con resolución anual y no incluyen doble conteo. Una sección sin registros no certifica ausencia de antecedentes. Consulta la fuente y sus anotaciones marginales.'));
}
async function openDetail(id) {
  const sequence = ++detailRequest;
  const title = el('h2', '', 'Cargando hoja de vida…'); title.id = 'candidate-dialog-title'; $('candidate-detail').replaceChildren(title);
  $('candidate-dialog').showModal();
  try { const c = await detail(id); if (sequence === detailRequest) renderDetail(c); }
  catch (error) { if (sequence === detailRequest) title.textContent = error.message; }
}
async function compare() {
  $('compare-content').textContent = 'Cargando comparación…'; $('compare-dialog').showModal();
  try {
    const candidates = await Promise.all([...chosen.keys()].map(detail));
    const wrap = el('div', 'table-wrap'), table = el('table', 'comparison-table'), head = el('thead'), row = el('tr');
    row.append(el('th', '', 'Indicador')); candidates.forEach(c => row.append(el('th', '', c.name))); head.append(row); table.append(head);
    const body = el('tbody');
    const rows = [
      ['Cargo y ámbito', c => roleLabel(c.role) + ' · ' + c.scope],
      ['Organización política', c => c.party],
      ['Estado en el JNE', c => c.status],
      ['Nivel de formación declarado', c => c.analysis.highest],
      ['Estudios declarados', c => c.education.filter(e => e.level !== 'Básica').map(e => e.degree + ' (' + (e.completed ? 'concluido' : 'sin conclusión registrada') + ')').join('; ') || 'No registra'],
      ['Empleos declarados', c => c.analysis.jobs ?? 'Pendiente'],
      ['Años sin solapamiento', c => c.analysis.years ?? 'Pendiente'],
      ['Declaraciones judiciales', c => c.analysis.legalLabel + (c.legal.length ? ': ' + c.legal.map(item => item.subject + ' / ' + item.outcome).join('; ') : '')],
      ['Ingresos brutos anuales', c => money(c.analysis.income) + (c.finances?.year ? ' (' + c.finances.year + ')' : '')],
      ['Secciones revisadas', c => c.analysis.coverage + '%'],
      ['Anotaciones marginales', c => c.annotations.length],
      ['Fecha de consulta', c => date(c.source.consultedAt)]
    ];
    for (const [label, value] of rows) { const row = el('tr'); const heading = el('th', '', label); heading.scope = 'row'; row.append(heading); candidates.forEach(c => row.append(el('td', '', value(c)))); body.append(row); }
    const sources = el('tr'); sources.append(el('th', '', 'Fuente de la ficha')); candidates.forEach(c => { const cell = el('td'); cell.append(link('Revisar JNE ↗', c.source.url)); sources.append(cell); }); body.append(sources);
    table.append(body); wrap.append(table); $('compare-content').replaceChildren(wrap);
  } catch (error) { $('compare-content').textContent = error.message; }
}
function downloadJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = el('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function invalidatePreview() { preview = null; $('import-save').disabled = true; $('import-preview-content').replaceChildren(); }
function previewImport() {
  invalidatePreview();
  try {
    const raw = $('import-json').value;
    if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024) throw new Error('Máximo 2 MB por archivo.');
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload.candidates) || !payload.candidates.length || payload.candidates.length > 500) throw new Error('Incluye de 1 a 500 fichas en candidates.');
    if (new Set(payload.candidates.map(c => c.id)).size !== payload.candidates.length) throw new Error('Hay IDs duplicados.');
    if (payload.candidates.some(c => !c.id || !c.name || !c.party || !['municipal','regional'].includes(c.role) || !c.source?.url || !c.source?.consultedAt)) throw new Error('Cada ficha necesita ID, nombre, organización, cargo y fuente con fecha.');
    const list = el('ul'); payload.candidates.forEach(c => list.append(el('li', '', c.name + ' · ' + roleLabel(c.role) + ' · ' + c.party)));
    $('import-preview-content').append(list); preview = payload; $('import-save').disabled = false;
    $('import-status').textContent = `${payload.candidates.length} fichas listas para validación y guardado. El servidor validará todos los campos; si falla alguno, el lote no se guardará.`;
  } catch (error) { $('import-status').textContent = error instanceof SyntaxError ? 'El texto no es un JSON válido.' : error.message; }
}
async function saveImport() {
  if (!preview) return; $('import-save').disabled = true;
  $('import-status').textContent = 'Validando y guardando fichas…';
  try {
    const result = await request('/api/candidates/import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...($('import-token').value ? { Authorization: 'Bearer ' + $('import-token').value } : {}) }, body: JSON.stringify(preview) });
    detailCache.clear(); chosen.clear(); renderTray(); await overview(); await loadList();
    $('import-status').textContent = `${result.imported} fichas guardadas. La lista ya está actualizada.`;
    preview = null; $('import-preview-content').replaceChildren();
  } catch (error) { $('import-status').textContent = error.message; $('import-save').disabled = false; }
}

export async function init() {
  document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => $(node.dataset.close).close()));
  for (const id of ['candidate-dialog', 'compare-dialog', 'import-dialog']) $(id).addEventListener('click', event => { if (event.target === $(id)) { const box = $(id).getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $(id).close(); } });
  $('candidate-dialog').addEventListener('close', () => { detailRequest++; });
  $('import-dialog').addEventListener('close', () => { $('import-token').value = ''; });
  $('candidate-search').addEventListener('input', () => { clearTimeout(timer); listController?.abort(); timer = setTimeout(() => { page = 1; loadList(); }, 240); });
  for (const id of ['candidate-role', 'candidate-party', 'candidate-sort']) $(id).addEventListener('change', () => { clearTimeout(timer); page = 1; loadList(); });
  $('candidate-prev').addEventListener('click', () => { page--; loadList(); });
  $('candidate-next').addEventListener('click', () => { page++; loadList(); });
  $('compare-open').addEventListener('click', compare);
  $('compare-clear').addEventListener('click', () => { chosen.clear(); renderTray(); if (lastList) renderCards(lastList.candidates); });
  $('candidate-import').addEventListener('click', () => $('import-dialog').showModal());
  $('import-preview').addEventListener('click', previewImport);
  $('import-save').addEventListener('click', saveImport);
  $('import-json').addEventListener('input', invalidatePreview);
  $('import-file').addEventListener('change', async () => {
    invalidatePreview(); const file = $('import-file').files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { $('import-status').textContent = 'El archivo supera los 2 MB.'; return; }
    $('import-json').value = await file.text(); previewImport();
  });
  $('import-example').addEventListener('click', async () => {
    try { const id = lastList?.candidates[0]?.id; if (!id) throw new Error('Limpia los filtros para cargar una ficha de ejemplo.'); const { analysis, ...record } = await detail(id); downloadJSON({ schemaVersion: 1, candidates: [record] }, 'ejemplo-hoja-de-vida.json'); $('import-status').textContent = 'El ejemplo contiene una ficha real del catálogo. Para agregar otra persona, cambia el ID, sus datos y la fuente. Un mismo ID actualiza la ficha existente.'; }
    catch (error) { $('import-status').textContent = error.message; }
  });
  try { await overview(); $('candidate-content').hidden = false; await loadList(); }
  catch (error) { $('candidate-status').textContent = error.message; }
}
