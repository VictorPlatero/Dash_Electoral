import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { analyze, normalize, partyKey, businessAnalytics } from '../public/candidate-model.js';
import { validateBatch } from './schema.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, party TEXT NOT NULL, role TEXT NOT NULL,
      search_text TEXT NOT NULL, status TEXT NOT NULL, consulted_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS candidates_role_party ON candidates(role, party);
    CREATE INDEX IF NOT EXISTS candidates_name ON candidates(name);
    CREATE TABLE IF NOT EXISTS education (candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, position INTEGER NOT NULL, level TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(candidate_id, position));
    CREATE TABLE IF NOT EXISTS experience (candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, position INTEGER NOT NULL, start_year INTEGER, end_year INTEGER, payload TEXT NOT NULL, PRIMARY KEY(candidate_id, position));
    CREATE TABLE IF NOT EXISTS legal_records (candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, position INTEGER NOT NULL, outcome TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(candidate_id, position));
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, imported_at TEXT NOT NULL, count INTEGER NOT NULL, origin TEXT NOT NULL);
    PRAGMA user_version=1;`);
  const columns = new Set(db.prepare('PRAGMA table_info(candidates)').all().map(column => column.name));
  if (!columns.has('party_key')) db.exec("ALTER TABLE candidates ADD COLUMN party_key TEXT NOT NULL DEFAULT ''");
  if (!columns.has('scope_key')) db.exec("ALTER TABLE candidates ADD COLUMN scope_key TEXT NOT NULL DEFAULT ''");
  const keys = db.prepare('UPDATE candidates SET party_key=?, scope_key=? WHERE id=?');
  for (const row of db.prepare("SELECT id, payload FROM candidates WHERE party_key='' OR scope_key=''").all()) {
    const candidate = JSON.parse(row.payload); keys.run(partyKey(candidate.party), partyKey(candidate.scope), row.id);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS electoral_reports (role TEXT NOT NULL, party_key TEXT NOT NULL, scope_key TEXT NOT NULL, percent REAL NOT NULL CHECK(percent>=0 AND percent<=100), payload TEXT NOT NULL, PRIMARY KEY(role,party_key,scope_key));
    CREATE INDEX IF NOT EXISTS candidates_report_join ON candidates(role,party_key,scope_key);
    PRAGMA user_version=2;`);
  const upsert = db.prepare(`INSERT INTO candidates (id,name,party,role,search_text,status,consulted_at,payload,party_key,scope_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, party=excluded.party, role=excluded.role, search_text=excluded.search_text, status=excluded.status, consulted_at=excluded.consulted_at, payload=excluded.payload, party_key=excluded.party_key, scope_key=excluded.scope_key`);
  const children = ['education', 'experience', 'legal_records'].map(table => db.prepare(`DELETE FROM ${table} WHERE candidate_id=?`));
  const insertEducation = db.prepare('INSERT INTO education VALUES (?, ?, ?, ?)');
  const insertExperience = db.prepare('INSERT INTO experience VALUES (?, ?, ?, ?, ?)');
  const insertLegal = db.prepare('INSERT INTO legal_records VALUES (?, ?, ?, ?)');
  const metadata = db.prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const detail = db.prepare('SELECT payload FROM candidates WHERE id=?');
  const report = db.prepare('SELECT payload FROM electoral_reports WHERE role=? AND party_key=? AND scope_key=?');
  const enrich = candidate => { const result = report.get(candidate.role,partyKey(candidate.party),partyKey(candidate.scope)); return { ...candidate, electoral: result ? JSON.parse(result.payload) : null }; };
  const all = () => db.prepare('SELECT payload FROM candidates ORDER BY name, id').all().map(row => enrich(JSON.parse(row.payload)));
  function filter(params) {
    const clauses = [], values = [];
    for (const key of ['role','party']) if (params.get(key)) { clauses.push(`c.${key}=?`); values.push(params.get(key)); }
    if (params.get('q')) { clauses.push("c.search_text LIKE ? ESCAPE '\\'"); values.push('%' + normalize(params.get('q')).replace(/[\\%_]/g,'\\$&') + '%'); }
    if (params.get('percentage') === 'reported') clauses.push('r.percent IS NOT NULL');
    if (params.get('percentage') === 'missing') clauses.push('r.percent IS NULL');
    return { where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', values };
  }
  const joined = ' FROM candidates c LEFT JOIN electoral_reports r ON c.role=r.role AND c.party_key=r.party_key AND c.scope_key=r.scope_key';
  const filtered = params => { const {where,values} = filter(params); return db.prepare('SELECT c.payload'+joined+where+' ORDER BY c.name,c.id').all(...values).map(row => enrich(JSON.parse(row.payload))); };
  return {
    db,
    import(payload, origin = 'manual', seedHash = '') {
      const candidates = validateBatch(payload);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const c of candidates) {
          upsert.run(c.id, c.name, c.party, c.role, normalize(c.name + ' ' + c.party + ' ' + c.education.map(e => e.degree).join(' ')), c.status, c.source.consultedAt, JSON.stringify(c), partyKey(c.party), partyKey(c.scope));
          children.forEach(statement => statement.run(c.id));
          c.education.forEach((item, index) => insertEducation.run(c.id, index, item.level, JSON.stringify(item)));
          c.experience.forEach((item, index) => insertExperience.run(c.id, index, item.startYear, item.endYear, JSON.stringify(item)));
          c.legal.forEach((item, index) => insertLegal.run(c.id, index, item.outcome, JSON.stringify(item)));
        }
        if (origin === 'JNE') {
          metadata.run('source', JSON.stringify({ consultedAt: payload.consultedAt, scope: payload.scope, unavailableLists: payload.unavailableLists || [] }));
          if (seedHash) metadata.run('seed_hash', seedHash);
        }
        db.prepare('INSERT INTO imports(imported_at,count,origin) VALUES (?,?,?)').run(new Date().toISOString(), candidates.length, origin);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return candidates.length;
    },
    seedHash: () => db.prepare("SELECT value FROM metadata WHERE key='seed_hash'").get()?.value,
    setReports(reports) {
      const rows = [];
      for (const role of ['municipal','regional']) {
        const election = reports[role], source = reports.sources.find(source => source.id === election.source);
        if (!source || !Number.isFinite(election.reportedProgress) || election.reportedProgress < 0 || election.reportedProgress > 100) throw new Error('Reporte electoral inválido');
        for (const [index,party] of election.parties.entries()) {
          if (!Number.isFinite(party.percent) || party.percent < 0 || party.percent > 100) throw new Error('Porcentaje electoral inválido');
          const record = {percent:party.percent,position:index+1,party:party.name,role,scope:election.scope,cutoff:election.cutoff,progress:election.reportedProgress,source:{name:source.name,url:source.url,type:source.type},status:'Reporte parcial por organización'};
          rows.push([role,partyKey(party.name),partyKey(election.scope),party.percent,JSON.stringify(record)]);
        }
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM electoral_reports');
        const insert = db.prepare('INSERT INTO electoral_reports VALUES (?,?,?,?,?)'); rows.forEach(row => insert.run(...row));
        db.exec('COMMIT');
      } catch(error) { db.exec('ROLLBACK'); throw error; }
    },
    get: id => { const row = detail.get(id); return row ? enrich(JSON.parse(row.payload)) : null; },
    all,
    filtered,
    analytics: params => businessAnalytics(filtered(params)),
    list(params) {
      const { where, values } = filter(params);
      const total = db.prepare('SELECT count(*) AS total' + joined + where).get(...values).total;
      const limit = Math.min(50, Math.max(1, Number.parseInt(params.get('limit'),10) || 12));
      const page = Math.min(Math.max(1, Math.ceil(total / limit)), Math.max(1, Number.parseInt(params.get('page'),10) || 1));
      const order = params.get('sort') === 'recent' ? 'c.consulted_at DESC,c.name,c.id' : params.get('sort') === 'votes' ? 'c.role,r.percent IS NULL,r.percent DESC,c.name,c.id' : 'c.name,c.id';
      const candidates = db.prepare(`SELECT c.payload${joined}${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, limit, (page - 1) * limit).map(row => {
        const c = enrich(JSON.parse(row.payload));
        return { id:c.id, name:c.name, party:c.party, role:c.role, scope:c.scope, status:c.status, source:c.source, photo:c.photo, description:c.description, electoral:c.electoral, analysis:analyze(c) };
      });
      return { candidates, total, page, limit };
    },
    overview() {
      const candidates = all(), source = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='source'").get()?.value || '{}');
      return { total: candidates.length, municipal: candidates.filter(c => c.role === 'municipal').length, regional: candidates.filter(c => c.role === 'regional').length, reviewed: candidates.filter(c => analyze(c).coverage === 100).length, parties: [...new Set(candidates.map(c => c.party))].sort(), latestConsultation: candidates.map(c => c.source.consultedAt).sort().at(-1) || null, source };
    },
    close: () => db.close()
  };
}
