import {csvCell, partyKey} from './candidate-model.js';

export function validateHistoryCut(cut) {
  const optionalPercent = value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
  const optionalVotes = value => value === null || (Number.isSafeInteger(value) && value >= 0);
  if (!cut || !/^[a-f0-9]{64}$/.test(cut.id) || !['municipal','regional'].includes(cut.election) ||
      !['territorial','archive'].includes(cut.sourceKind) || !/^\d{4}-\d{2}-\d{2}$/.test(cut.electionDate) ||
      !/^\d{6}$/.test(cut.zoneCode) || typeof cut.sourceName !== 'string' || typeof cut.title !== 'string' ||
      typeof cut.scope !== 'string' || typeof cut.sourceUrl !== 'string' || !cut.sourceUrl.startsWith('https://') ||
      new URL(cut.sourceUrl).hostname !== cut.sourceKey ||
      (cut.reportedAt !== null && (typeof cut.reportedAt !== 'string' || !Number.isFinite(Date.parse(cut.reportedAt)))) ||
      !optionalPercent(cut.progress) || !optionalVotes(cut.validVotes) || !optionalVotes(cut.castVotes) ||
      !Array.isArray(cut.parties) || !cut.parties.length || cut.parties.some(p => typeof p?.name !== 'string' ||
        !partyKey(p.name) || p.percent == null || !optionalPercent(p.percent) || !optionalVotes(p.votes)) ||
      new Set(cut.parties.map(p => partyKey(p.name))).size !== cut.parties.length) {
    throw new Error('El historial contiene un corte inválido.');
  }
  return cut;
}

export function cutsFor(history, election, zoneCode, electionDate) {
  return history.filter(cut => cut.electionDate === electionDate && cut.election === election && cut.zoneCode === zoneCode)
    .sort((a, b) => (b.reportedAt ? Date.parse(b.reportedAt) : -Infinity) -
      (a.reportedAt ? Date.parse(a.reportedAt) : -Infinity) ||
      (b.consultedAt || '').localeCompare(a.consultedAt || '') ||
      a.sourceName.localeCompare(b.sourceName, 'es') || a.id.localeCompare(b.id));
}

export function isEarlierCut(before, after) {
  return Boolean(before?.reportedAt && after?.reportedAt &&
    before.electionDate === after.electionDate && before.election === after.election &&
    before.zoneCode === after.zoneCode && before.sourceKind === after.sourceKind &&
    before.sourceKey === after.sourceKey && Date.parse(before.reportedAt) < Date.parse(after.reportedAt));
}

const difference = (before, after) => Number.isFinite(before) && Number.isFinite(after)
  ? Number((after - before).toFixed(3)) || 0 : null;

export function compareCuts(before, after) {
  if (before && !isEarlierCut(before, after)) throw new Error('Los cortes deben ser de la misma fuente, elección y ámbito, con fechas distintas.');
  const prior = new Map(before?.parties.map(party => [partyKey(party.name), party]));
  const rows = [...after.parties].sort((a, b) => b.percent - a.percent).map(party => {
    const previous = prior.get(partyKey(party.name));
    prior.delete(partyKey(party.name));
    return {
      name: party.name, previousPercent: previous?.percent ?? null, percent: party.percent,
      previousVotes: previous?.votes ?? null, votes: party.votes,
      percentChange: difference(previous?.percent, party.percent), voteChange: difference(previous?.votes, party.votes)
    };
  });
  for (const party of prior.values()) {
    rows.push({name: party.name, previousPercent: party.percent, percent: null, previousVotes: party.votes,
      votes: null, percentChange: null, voteChange: null});
  }
  return {rows, progressChange: difference(before?.progress, after.progress)};
}

export function historyCSV(before, after) {
  const {rows} = compareCuts(before, after);
  const headings = ['id_corte','id_corte_anterior','fecha_eleccion','cargo','ambito','fuente','url_fuente','corte',
    'corte_anterior','fecha_consulta','organizacion','porcentaje_anterior','porcentaje_actual','variacion_pp',
    'votos_anteriores','votos_actuales','variacion_votos'];
  const records = rows.map(row => [after.id, before?.id, after.electionDate, after.title, after.scope, after.sourceName,
    after.sourceUrl, after.reportedAt || after.cutoffLabel, before?.reportedAt, after.consultedAt, row.name,
    row.previousPercent, row.percent, row.percentChange, row.previousVotes, row.votes, row.voteChange]);
  const cell = value => Number.isFinite(value) ? '"' + value + '"' : csvCell(value);
  return '\uFEFF' + [headings, ...records].map(row => row.map(cell).join(',')).join('\r\n');
}
