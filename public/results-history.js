import {humanize} from './candidate-model.js';
import {compareCuts, cutsFor, historyCSV, isEarlierCut, validateHistoryCut} from './results-history-model.js';

const $ = id => document.getElementById(id);
const date = new Intl.DateTimeFormat('es-PE', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Lima'});
const number = new Intl.NumberFormat('es-PE', {maximumFractionDigits:3});
const cutoff = cut => cut.cutoffLabel || (cut.reportedAt ? date.format(new Date(cut.reportedAt)) : 'Fecha de corte no indicada');
const formatted = (value, suffix = '') => value == null ? '—' : number.format(value) + suffix;
const signed = (value, suffix = '') => value == null ? '—' : (value > 0 ? '+' : '') + formatted(value, suffix);
let request, history, context, error, available = [];

function cutOptions(cuts, withSource) {
  const labels = cuts.map(cut => cutoff(cut) + (withSource ? ' · ' + cut.sourceName : ''));
  return cuts.map((cut, index) => {
    const label = labels[index];
    const revision = labels.indexOf(label) !== labels.lastIndexOf(label) ? ' · ' + cut.id.slice(0, 8) : '';
    return new Option(label + revision, cut.id);
  });
}

function renderComparison() {
  const current = available.find(cut => cut.id === $('history-cut').value);
  if (!current) return;
  const before = available.find(cut => cut.id === $('history-baseline').value);
  const {rows, progressChange} = compareCuts(before, current);
  const leader = [...current.parties].sort((a, b) => b.percent - a.percent)[0];
  const facts = [
    'Primera lista: ' + humanize(leader.name) + ' (' + formatted(leader.percent, '%') + ')',
    'Avance de actas: ' + formatted(current.progress, '%'),
    'Votos válidos: ' + formatted(current.validVotes),
    'Consulta: ' + (current.consultedAt || 'sin fecha')
  ];
  if (progressChange != null) facts.push('Cambio en avance: ' + signed(progressChange, ' pp'));
  if (current.revision) facts.push('Copia en Git: ' + current.revision);
  $('history-summary').textContent = facts.join(' · ');
  const columns = before
    ? ['Organización', '% anterior', '% del corte', 'Cambio (pp)', 'Votos del corte', 'Cambio en votos']
    : ['Organización', '% del corte', 'Votos del corte'];
  const heading = document.createElement('tr');
  for (const name of columns) {
    const th = document.createElement('th');
    th.scope = 'col'; th.textContent = name; heading.append(th);
  }
  $('history-head').replaceChildren(heading);
  $('history-body').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    const values = before
      ? [row.name, formatted(row.previousPercent, '%'), formatted(row.percent, '%'), signed(row.percentChange),
        formatted(row.votes), signed(row.voteChange)]
      : [row.name, formatted(row.percent, '%'), formatted(row.votes)];
    for (const [index, value] of values.entries()) {
      const td = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) td.scope = 'row';
      td.textContent = value; tr.append(td);
    }
    return tr;
  }));
  const source = $('history-source');
  source.textContent = 'Fuente del corte: ' + current.sourceName + ' ↗';
  source.href = current.sourceUrl;
  $('history-coverage').textContent = (current.complete ? 'Listado completo de la fuente.' : 'Listado parcial de la fuente.') +
    ' El guion indica un dato ausente.';
  $('history-export').onclick = () => {
    const href = URL.createObjectURL(new Blob([historyCSV(before, current)], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = href;
    link.download = `tacna-historial-${current.election}-${current.zoneCode}-${current.reportedAt?.slice(0,10) || 'sin-fecha'}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
}

function selectCut() {
  const current = available.find(cut => cut.id === $('history-cut').value);
  if (!current) return;
  const baseline = $('history-baseline'), previous = baseline.value;
  const earlier = available.filter(cut => isEarlierCut(cut, current));
  baseline.replaceChildren(new Option('Sin comparación', ''), ...cutOptions(earlier, false));
  baseline.disabled = !earlier.length;
  baseline.value = earlier.find(cut => cut.id === previous)?.id || earlier[0]?.id || '';
  $('history-compatibility').textContent = earlier.length ? 'La comparación usa la misma fuente, cargo y ámbito.' :
    'Este corte no tiene un corte anterior comparable de la misma fuente en este ámbito.';
  renderComparison();
}

function renderOptions() {
  available = cutsFor(history || [], context.election, context.zoneCode, context.electionDate);
  const select = $('history-cut'), previous = select.value;
  const count = available.length;
  $('history-count').textContent = count ? `${count} ${count === 1 ? 'corte' : 'cortes'}` : '';
  $('history-data').hidden = count === 0;
  $('history-status').textContent = error || (history ? (count ? '' : 'Todavía no hay cortes guardados para este ámbito.') : 'Cargando historial…');
  select.replaceChildren(...cutOptions(available, true));
  if (available.some(cut => cut.id === previous)) select.value = previous;
  selectCut();
}

export function renderHistory(electionDate, election, zoneCode) {
  context = {electionDate, election, zoneCode};
  if (!request) {
    $('history-cut').addEventListener('change', selectCut);
    $('history-baseline').addEventListener('change', renderComparison);
    request = fetch('./electoral-history.json', {signal:AbortSignal.timeout(12000)})
      .then(response => {
        if (!response.ok) throw new Error('Historial no disponible');
        return response.json();
      }).then(data => {
        if (data.schemaVersion !== 1 || !Array.isArray(data.cuts)) throw new Error('Formato inválido');
        history = data.cuts.map(validateHistoryCut);
      }).catch(() => {
        error = 'No se pudo cargar el historial de cortes. Recarga la página para intentarlo de nuevo.';
      }).then(renderOptions);
  }
  renderOptions();
}
