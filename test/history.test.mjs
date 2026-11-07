import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareCuts, cutsFor, historyCSV, isEarlierCut, validateHistoryCut} from '../public/results-history-model.js';
import {fetchPublishedCuts, makeCuts, mergeHistory} from '../scripts/history.mjs';

const asset = async name => JSON.parse(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'));
const [data, snapshot, history] = await Promise.all(['data.json','territorial.json','electoral-history.json'].map(asset));
const cuts = history.cuts.map(validateHistoryCut);
const tacna = cutsFor(cuts, 'municipal', '220100', data.electionDate);
const latest = tacna.find(cut => cut.sourceKind === 'archive' && cut.reportedAt === '2026-10-06T17:46:00.000Z');
const earlier = tacna.find(cut => cut.sourceKind === 'archive' && cut.revision === '8ec1119');
const andina = tacna.find(cut => cut.sourceKind === 'territorial');

test('historial: los dos cortes municipales recuperados comparan porcentajes y avance', () => {
  assert.equal(earlier.revision, '8ec1119');
  assert.equal(earlier.reportedAt, '2026-10-05T11:52:00.000Z');
  assert.equal(latest.reportedAt, '2026-10-06T17:46:00.000Z');
  assert.equal(isEarlierCut(earlier, latest), true);
  const result = compareCuts(earlier, latest);
  assert.equal(result.progressChange, 6.051);
  assert.equal(result.rows[0].percentChange, -0.513);
  assert.equal(result.rows[0].voteChange, null);
  assert.match(historyCSV(earlier, latest), /"28\.556","28\.043","-0\.513","","",""/);
});

test('historial: excluye comparaciones entre fuentes, ámbitos, elecciones y cortes sin fecha', () => {
  assert.equal(isEarlierCut(andina, latest), false);
  assert.equal(isEarlierCut({...earlier, zoneCode: '220400'}, latest), false);
  assert.equal(isEarlierCut({...earlier, election: 'regional'}, latest), false);
  assert.equal(isEarlierCut({...earlier, electionDate: '2022-10-02'}, latest), false);
  assert.equal(isEarlierCut({...earlier, reportedAt: null}, latest), false);
  assert.equal(isEarlierCut(latest, latest), false);
  assert.throws(() => compareCuts(andina, latest), /misma fuente/);
  const candarave = cutsFor(cuts, 'municipal', '220400', data.electionDate).find(cut => cut.reportedAt === null);
  assert.equal(candarave.reportedAt, null);
  assert.equal(candarave.progress, null);
});

test('historial: una lista ausente conserva valores nulos y una lista con cero conserva el cero', () => {
  const old = {...earlier, parties: [{name:'Una lista', percent:2, votes:5}, {name:'Lista estable', percent:0, votes:0}]};
  const recent = {...latest, parties: [{name:'Lista estable', percent:1, votes:3}, {name:'Nueva', percent:4, votes:10}]};
  const result = compareCuts(old, recent).rows;
  assert.equal(result.find(row => row.name === 'Lista estable').previousPercent, 0);
  assert.equal(result.find(row => row.name === 'Lista estable').voteChange, 3);
  assert.equal(result.find(row => row.name === 'Nueva').percentChange, null);
  assert.equal(result.find(row => row.name === 'Una lista').percent, null);
});

test('historial: una consulta repetida no borra cortes previos ni crea un duplicado', () => {
  const current = mergeHistory(cuts, makeCuts(data, snapshot));
  const repeated = makeCuts({...data, resultsResearched:'2026-11-07'}, snapshot);
  assert.deepEqual(mergeHistory(current, repeated), current);
  const nextDate = new Date(Math.max(...current.filter(cut => cut.reportedAt).map(cut => Date.parse(cut.reportedAt))) + 1000).toISOString();
  const newSnapshot = {...snapshot, reports:snapshot.reports.map(report => report.election === 'municipal' && report.zoneCode === '220100'
    ? {...report, reportedAt:nextDate} : report)};
  const merged = mergeHistory(current, makeCuts(data, newSnapshot));
  assert.equal(merged.length, current.length + 1);
  assert.ok(merged.some(cut => cut.id === andina.id));
});

test('historial: Supabase se consulta por páginas con la clave publicable y cortes publicados', async () => {
  const pages = [cuts.slice(0,1), cuts.slice(1,2), []];
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({url:new URL(url), key:options.headers.apikey});
    return Response.json(pages.shift().map(payload => ({id:payload.id, payload})));
  };
  const result = await fetchPublishedCuts('https://example.supabase.co','sb_publishable_test',fetcher);
  assert.deepEqual(result, cuts.slice(0,2));
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.url.pathname === '/rest/v1/electoral_cuts' &&
    request.url.searchParams.get('published') === 'eq.true' && request.key === 'sb_publishable_test'));
  assert.equal(requests[1].url.searchParams.get('id'),'gt.' + cuts[0].id);
  await assert.rejects(fetchPublishedCuts('https://example.supabase.co','sb_secret_test',fetcher), /PUBLISHABLE_KEY/);
});
