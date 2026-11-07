import {readFile, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resultReport} from '../public/results-model.js';
import {partyKey} from '../public/candidate-model.js';
import {validateHistoryCut} from '../public/results-history-model.js';

export const historyFile = 'public/electoral-history.json';
const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function archiveTimestamp(label) {
  const parts = /^(\d{2}) ([a-z]{3}) (\d{4}) · (\d{2}):(\d{2})$/.exec(label || '');
  if (!parts || !months.includes(parts[2])) return null;
  const [, day, month, year, hour, minute] = parts;
  const calendar = `${year}-${String(months.indexOf(month) + 1).padStart(2, '0')}-${day}`;
  const midnight = new Date(calendar + 'T00:00:00Z');
  if (!Number.isFinite(+midnight) || midnight.toISOString().slice(0, 10) !== calendar || Number(hour) > 23 || Number(minute) > 59) return null;
  return new Date(calendar + `T${hour}:${minute}:00-05:00`).toISOString();
}

export function makeCuts(data, snapshot, revision = null) {
  const elections = ['municipal','regional'];
  const reports = elections.map(election => resultReport(data, snapshot, election, 'archive'));
  for (const report of snapshot?.reports || []) {
    if ((report.election === 'municipal' && report.zoneLevel === 'province') ||
        (report.election === 'regional' && report.zoneLevel === 'department' && report.zoneCode === '220000')) {
      const result = resultReport(data, snapshot, report.election, 'territorial', report.zoneCode);
      if (result) reports.push(result);
    }
  }
  return reports.map(report => {
    const sourceKey = new URL(report.sourceUrl).hostname;
    const reportedAt = report.reportedAt ? new Date(report.reportedAt).toISOString() : archiveTimestamp(report.cutoffLabel);
    const parties = report.parties.map(({name, percent, votes}) => ({name, percent, votes: votes ?? null}));
    const payload = {
      electionDate: data.electionDate, election: report.election, title: report.title, scope: report.scope,
      zoneCode: report.zoneCode, sourceKind: report.sourceKind, sourceKey, sourceName: report.sourceName,
      sourceUrl: report.sourceUrl, reportedAt, cutoffLabel: report.cutoffLabel || null,
      consultedAt: report.consultedAt || data.researched || null, complete: report.complete,
      totalsCompatible: report.totalsCompatible, progress: report.progress ?? null,
      validVotes: report.validVotes ?? null, castVotes: report.castVotes ?? null, parties,
      revision
    };
    // Consultar otra vez la misma publicación conserva su primer registro.
    const signature = [payload.electionDate, payload.election, payload.zoneCode, payload.sourceKind, sourceKey,
      reportedAt || payload.cutoffLabel, payload.progress, payload.validVotes, payload.castVotes, payload.complete,
      parties.map(p => [partyKey(p.name), p.percent, p.votes]).sort((a, b) => a[0].localeCompare(b[0], 'es'))];
    return {id: createHash('sha256').update(JSON.stringify(signature)).digest('hex'), ...payload};
  });
}

export function mergeHistory(...groups) {
  const cuts = new Map();
  for (const cut of groups.flat()) {
    validateHistoryCut(cut);
    if (!cuts.has(cut.id)) cuts.set(cut.id, cut);
  }
  return [...cuts.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function readHistory(path = historyFile) {
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (value.schemaVersion !== 1 || !Array.isArray(value.cuts)) throw new Error('Formato de historial inválido.');
  return mergeHistory(value.cuts);
}

export function serializeHistory(cuts) {
  return JSON.stringify({schemaVersion: 1, cuts}, null, 2) + '\n';
}

export async function saveCuts(cuts) {
  const existing = await readHistory();
  const merged = mergeHistory(existing, cuts);
  if (merged.length !== existing.length) {
    await writeFile(historyFile + '.tmp', serializeHistory(merged));
    await rename(historyFile + '.tmp', historyFile);
  }
  return {added: merged.length - existing.length, total: merged.length};
}

function supabaseEndpoint(url) {
  const project = new URL(url);
  if (project.protocol !== 'https:' || project.username || project.password || project.pathname !== '/' ||
      project.search || project.hash) throw new Error('SUPABASE_URL debe ser la URL HTTPS del proyecto.');
  return new URL('/rest/v1/electoral_cuts', project);
}

async function querySupabase(fetcher, endpoint, options) {
  const response = await fetcher(endpoint, {...options, signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Supabase devolvió HTTP ${response.status} para electoral_cuts.`);
  return response;
}

export async function fetchPublishedCuts(url, key, fetcher = fetch) {
  if (!key?.startsWith('sb_publishable_')) throw new Error('Usa una clave SUPABASE_PUBLISHABLE_KEY.');
  const endpoint = supabaseEndpoint(url);
  const headers = {apikey: key};
  endpoint.search = new URLSearchParams({select: 'id,payload', published: 'eq.true', order: 'id.asc', limit: '100'});
  const cuts = [];
  let last = '';
  for (;;) {
    const page = await (await querySupabase(fetcher, endpoint, {headers})).json();
    if (!Array.isArray(page)) throw new Error('Respuesta de historial inválida.');
    if (!page.length) return mergeHistory(cuts);
    for (const row of page) {
      if (!row.payload || row.id !== row.payload.id || !/^[a-f0-9]{64}$/.test(row.id) || row.id <= last) {
        throw new Error('Paginación de historial inválida.');
      }
      last = row.id;
      cuts.push(row.payload);
    }
    endpoint.searchParams.set('id', 'gt.' + last);
  }
}

async function publishCuts(url, key, cuts) {
  if (!key?.startsWith('sb_secret_')) throw new Error('Usa una clave SUPABASE_SECRET_KEY desde el servidor.');
  const endpoint = supabaseEndpoint(url);
  endpoint.searchParams.set('on_conflict', 'id');
  for (let index = 0; index < cuts.length; index += 100) {
    const rows = cuts.slice(index, index + 100).map(cut => ({id: cut.id, payload: cut, published: true}));
    await querySupabase(fetch, endpoint, {method: 'POST', headers: {apikey: key, 'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify(rows)});
  }
}

async function main() {
  const [command = 'capture', flag, commit] = process.argv.slice(2);
  if (command === 'publish' && !flag) {
    const cuts = await readHistory();
    await publishCuts(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, cuts);
    console.log(`Se enviaron ${cuts.length} cortes al historial de Supabase.`);
  } else if (command === 'capture' && !flag) {
    const data = JSON.parse(await readFile('public/data.json', 'utf8'));
    const snapshot = JSON.parse(await readFile('public/territorial.json', 'utf8'));
    console.log(await saveCuts(makeCuts(data, snapshot)));
  } else if (command === 'capture' && flag === '--commit' && /^[a-f0-9]{7,40}$/.test(commit || '')) {
    const data = JSON.parse(execFileSync('git', ['show', commit + ':public/data.json'], {encoding: 'utf8'}));
    const hasMap = execFileSync('git', ['ls-tree', '--name-only', commit, '--', 'public/territorial.json'], {encoding: 'utf8'}).trim();
    const snapshot = hasMap ? JSON.parse(execFileSync('git', ['show', commit + ':public/territorial.json'], {encoding: 'utf8'})) : null;
    console.log(await saveCuts(makeCuts(data, snapshot, commit)));
  } else {
    throw new Error('Usa history.mjs capture [--commit <hash>] o history.mjs publish.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
