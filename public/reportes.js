const form = document.querySelector('#filtros');
const output = document.querySelector('#reportes');
const index = document.querySelector('#indice-reportes');
const status = document.querySelector('#estado');
const lima = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima' });
const num = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 });
const show = (value, unit = '') => Number.isFinite(value) ? num.format(value) + unit : 'Sin dato';
const element = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });
const group = cut => JSON.stringify([cut.election, cut.scope, cut.sourceKey]);

function filter(name, values, all) {
  const label = element('label', name);
  const select = document.createElement('select');
  select.add(new Option(all, ''));
  for (const value of values) select.add(new Option(value));
  label.append(select);
  form.append(label);
  return select;
}

function report(title, headers, rows) {
  const section = document.createElement('section');
  const number = index.childElementCount + 1;
  section.id = 'reporte-' + number;
  section.append(element('h2', number + '. ' + title));
  const item = document.createElement('li');
  const link = element('a', title);
  link.href = '#' + section.id;
  item.append(link, ' (' + rows.length + (rows.length === 1 ? ' fila)' : ' filas)'));
  index.append(item);
  if (!rows.length) section.append(element('p', 'No hay datos para los filtros seleccionados.'));
  else {
    const wrapper = document.createElement('div');
    wrapper.className = 'tabla';
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const name of headers) header.append(element('th', name));
    const body = table.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) row.insertCell().textContent = value;
    }
    wrapper.append(table);
    section.append(wrapper);
  }
  output.append(section);
}

try {
  const response = await fetch('./electoral-history.json');
  if (!response.ok) throw new Error('No se pudo cargar el historial.');
  const { cuts } = await response.json();
  const dated = cuts.map(cut => ({
    ...cut, date: cut.reportedAt ? lima.format(new Date(cut.reportedAt)) : ''
  })).sort((a, b) => (b.reportedAt || '').localeCompare(a.reportedAt || ''));
  const distinct = items => [...new Set(items)].sort();
  const year = filter('Año', distinct(dated.map(c => c.date.slice(0, 4)).filter(Boolean)), 'Todos');
  const month = filter('Mes', distinct(dated.map(c => c.date.slice(5, 7)).filter(Boolean)), 'Todos');
  const day = filter('Día', distinct(dated.map(c => c.date.slice(8, 10)).filter(Boolean)), 'Todos');
  const scope = filter('Ámbito', distinct(dated.map(c => c.scope)), 'Todos');
  const source = filter('Fuente', distinct(dated.map(c => c.sourceName)), 'Todas');
  const timeline = document.querySelector('#timeline');
  const dateLabel = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
  const timelineButtons = new Map();
  function addStop(date, label) {
    const button = element('button', label);
    button.type = 'button';
    const count = element('small', '');
    button.append(count);
    button.addEventListener('click', () => {
      const [y = '', m = '', d = ''] = date.split('-');
      year.value = y;
      month.value = m;
      day.value = d;
      render();
    });
    timeline.append(button);
    timelineButtons.set(date, { button, count });
  }
  addStop('', 'Todos los cortes');
  for (const date of distinct(dated.map(c => c.date).filter(Boolean)).reverse()) {
    addStop(date, dateLabel.format(new Date(date)));
  }
  const describe = c => [c.date || 'Sin fecha validada', c.title, c.scope, c.sourceName];
  const columns = ['Corte (Lima)', 'Cargo', 'Ámbito', 'Fuente'];
  const ranked = c => c.parties.filter(p => Number.isFinite(p.percent)).sort((a, b) => b.percent - a.percent);
  function render() {
    const available = dated.filter(c =>
      (!scope.value || c.scope === scope.value) &&
      (!source.value || c.sourceName === source.value));
    const selected = available.filter(c =>
      (!year.value || c.date.startsWith(year.value)) &&
      (!month.value || c.date.slice(5, 7) === month.value) &&
      (!day.value || c.date.slice(8, 10) === day.value));
    const active = [year.value, month.value, day.value].filter(Boolean).join('-');
    for (const [date, { button, count }] of timelineButtons) {
      const total = date ? available.filter(c => c.date === date).length : available.length;
      button.hidden = Boolean(date) && total === 0 && date !== active;
      button.setAttribute('aria-pressed', String(date === active));
      count.textContent = total === 1 ? '1 corte' : total + ' cortes';
    }
    // Los cortes sin fecha aparecen únicamente cuando no hay filtro temporal.
    const latest = [...new Map(selected.slice().reverse().map(c => [group(c), c])).values()];
    index.replaceChildren();
    output.replaceChildren();
    status.textContent = selected.length + ' cortes disponibles. Los porcentajes corresponden a cada fuente y ámbito.';
    report('Resultados por organización · último corte', [...columns, 'Organización', '%', 'Votos'],
      latest.flatMap(c => ranked(c).map(p => [...describe(c), p.name, show(p.percent), show(p.votes)])));
    report('Avance de actas', [...columns, 'Avance', 'Votos válidos'],
      selected.filter(c => c.totalsCompatible && Number.isFinite(c.progress)).map(c => [...describe(c), show(c.progress, '%'), show(c.validVotes)]));
    report('Brecha entre las dos primeras listas', [...columns, 'Primera', 'Segunda', 'Brecha'],
      selected.flatMap(c => {
        const [first, second] = ranked(c);
        return second ? [[...describe(c), first.name, second.name, show(first.percent - second.percent, ' pp')]] : [];
      }));
    report('Evolución del porcentaje por organización', [...columns, 'Organización', 'Fecha anterior', 'Anterior', 'Actual', 'Variación'],
      selected.flatMap(c => {
        if (!c.date) return [];
        const previous = available.find(p => group(p) === group(c) && p.date && p.reportedAt < c.reportedAt);
        if (!previous) return [];
        const percentages = new Map(ranked(previous).map(p => [p.name, p.percent]));
        return ranked(c).filter(p => percentages.has(p.name)).map(p => [
          ...describe(c), p.name, previous.date, show(percentages.get(p.name), '%'), show(p.percent, '%'),
          show(p.percent - percentages.get(p.name), ' pp')
        ]);
      }));
    report('Resultados por provincia · lista con mayor porcentaje publicado', [...columns, 'Lista', 'Porcentaje'],
      latest.filter(c => c.election !== 'regional').flatMap(c => {
        const [first] = ranked(c);
        return first ? [[...describe(c), first.name, show(first.percent, '%')]] : [];
      }));
    report('Cobertura de cortes por fuente', ['Fuente', 'Cortes', 'Con fecha validada', 'Ámbitos'],
      distinct(selected.map(c => c.sourceName)).map(name => {
        const items = selected.filter(c => c.sourceName === name);
        return [name, items.length, items.filter(c => c.date).length, distinct(items.map(c => c.scope)).length];
      }));
  }
  form.addEventListener('change', render);
  render();
} catch {
  status.textContent = 'No se pudo cargar el historial electoral.';
}
