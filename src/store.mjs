import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { analyze, normalize } from '../public/candidate-model.js';
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
  const upsert = db.prepare(`INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, party=excluded.party, role=excluded.role, search_text=excluded.search_text, status=excluded.status, consulted_at=excluded.consulted_at, payload=excluded.payload`);
  const children = ['education', 'experience', 'legal_records'].map(table => db.prepare(`DELETE FROM ${table} WHERE candidate_id=?`));
  const insertEducation = db.prepare('INSERT INTO education VALUES (?, ?, ?, ?)');
  const insertExperience = db.prepare('INSERT INTO experience VALUES (?, ?, ?, ?, ?)');
  const insertLegal = db.prepare('INSERT INTO legal_records VALUES (?, ?, ?, ?)');
  const metadata = db.prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const detail = db.prepare('SELECT payload FROM candidates WHERE id=?');
  const all = () => db.prepare('SELECT payload FROM candidates ORDER BY name, id').all().map(row => JSON.parse(row.payload));
  return {
    db,
    import(payload, origin = 'manual', seedHash = '') {
      const candidates = validateBatch(payload);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const c of candidates) {
          upsert.run(c.id, c.name, c.party, c.role, normalize(c.name + ' ' + c.party + ' ' + c.education.map(e => e.degree).join(' ')), c.status, c.source.consultedAt, JSON.stringify(c));
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
    get: id => { const row = detail.get(id); return row ? JSON.parse(row.payload) : null; },
    all,
    list(params) {
      const clauses = [], values = [];
      for (const key of ['role', 'party']) if (params.get(key)) { clauses.push(`${key}=?`); values.push(params.get(key)); }
      if (params.get('q')) { clauses.push("search_text LIKE ? ESCAPE '\\'"); values.push('%' + normalize(params.get('q')).replace(/[\\%_]/g, '\\$&') + '%'); }
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
      const total = db.prepare('SELECT count(*) AS total FROM candidates' + where).get(...values).total;
      const limit = Math.min(50, Math.max(1, Number.parseInt(params.get('limit'),10) || 12));
      const page = Math.min(Math.max(1, Math.ceil(total / limit)), Math.max(1, Number.parseInt(params.get('page'),10) || 1));
      const order = params.get('sort') === 'recent' ? 'consulted_at DESC, name, id' : 'name, id';
      const candidates = db.prepare(`SELECT payload FROM candidates${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, limit, (page - 1) * limit).map(row => {
        const c = JSON.parse(row.payload);
        return { id: c.id, name: c.name, party: c.party, role: c.role, scope: c.scope, status: c.status, source: c.source, analysis: analyze(c) };
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
