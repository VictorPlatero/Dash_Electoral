import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { openStore } from '../src/store.mjs';
import { analyze, candidateCSV } from '../public/candidate-model.js';
import { validateBatch } from '../src/schema.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png' };
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };

export async function createDashboardServer({ root = resolve(project, 'dist'), dbPath = process.env.DATABASE_PATH || resolve(project, 'storage/candidates.sqlite'), adminToken = process.env.ADMIN_TOKEN || '' } = {}) {
  const store = openStore(dbPath), staticCache = new Map();
  try {
    store.setReports(JSON.parse(await readFile(resolve(root,'data.json'),'utf8')));
    const seed = await readFile(resolve(root, 'candidates.json'), 'utf8');
    const hash = createHash('sha256').update(seed).digest('hex');
    if (store.seedHash() !== hash) store.import(JSON.parse(seed), 'JNE', hash);
  } catch (error) { store.close(); throw new Error(`No se pudo cargar la base inicial. Ejecuta build. ${error.message}`); }
  const json = (res, status, payload) => { res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
  const canWrite = req => {
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (adminToken) return timingSafeEqual(createHash('sha256').update(token).digest(), createHash('sha256').update(adminToken).digest());
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + req.headers.host).hostname);
  };
  async function body(req) {
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 2 * 1024 * 1024) throw Object.assign(new Error('Archivo demasiado grande: máximo 2 MB'), { status: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), name = decodeURIComponent(url.pathname);
      if(name==='/runtime.json' && ['GET','HEAD'].includes(req.method)) return json(res,200,{mode:'server',version:'2.1.2'});
      if (name.startsWith('/api/')) {
        if (name === '/api/candidates/import' && req.method === 'POST') {
          if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host && req.headers.origin !== 'https://' + req.headers.host) return json(res, 403, { error: 'Origen no permitido' });
          if (!canWrite(req)) return json(res, 401, { error: 'Se requiere la clave de administración' });
          if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Content-Type application/json requerido' });
          const payload = await body(req); validateBatch(payload);
          return json(res, 200, { imported: store.import(payload), message: 'Fichas guardadas en SQLite' });
        }
        if (!['GET','HEAD'].includes(req.method)) return json(res, 405, { error: 'Método no permitido' });
        if (name === '/api/health') return json(res, 200, { status: 'ok', database: 'sqlite' });
        if (name === '/api/candidates/meta') return json(res, 200, { ...store.overview(), canWrite: canWrite(req), storage: 'SQLite' });
        if (name === '/api/candidates') return json(res, 200, store.list(url.searchParams));
        if (name === '/api/candidates/analytics') return json(res, 200, store.analytics(url.searchParams));
        if (name === '/api/candidates/backup') {
          res.writeHead(200, { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="tacna-hojas-de-vida.json"', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), candidates: store.all() }, null, 2));
        }
        if (name === '/api/candidates/export') {
          res.writeHead(200, { ...security, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tacna-candidatos.csv"', 'Cache-Control': 'no-store' });
          return res.end(candidateCSV(store.filtered(url.searchParams)));
        }
        if (name.startsWith('/api/candidates/')) {
          const candidate = store.get(name.slice('/api/candidates/'.length));
          return candidate ? json(res, 200, { ...candidate, analysis: analyze(candidate) }) : json(res, 404, { error: 'Candidato no encontrado' });
        }
        return json(res, 404, { error: 'Ruta no encontrada' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, security); return res.end(); }
      const file = resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + sep)) { res.writeHead(403, security); return res.end(); }
      const info = await stat(file);
      let asset = staticCache.get(file);
      if (!asset || asset.mtime !== info.mtimeMs) {
        const data = await readFile(file); asset = { mtime: info.mtimeMs, data, compressed: ['.html','.css','.js','.json','.svg'].includes(extname(file)) ? gzipSync(data) : null, etag: '"' + createHash('sha256').update(data).digest('hex').slice(0,24) + '"' }; staticCache.set(file, asset);
      }
      const headers = { ...security, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: asset.etag, Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); return res.end(); }
      const compress = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && asset.data.length > 1024 && ['.html','.css','.js','.json','.svg'].includes(extname(file));
      const data = compress ? asset.compressed : asset.data;
      res.writeHead(200, { ...headers, ...(compress ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error.status || (['ENOENT','ENOTDIR','EISDIR'].includes(error.code) || error instanceof URIError ? 404 : 500);
      if (status === 500) console.error(error);
      json(res, status, { error: status === 500 ? 'No se pudo procesar la solicitud' : error.message });
    }
  });
  server.on('close', () => store.close());
  server.requestTimeout = 15000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createDashboardServer();
  const port = Number(process.env.PORT || 4173);
  const host=process.env.HOST || (process.env.RENDER==='true'?'0.0.0.0':'127.0.0.1');
  server.listen(port,host,()=>console.log(`Dashboard: http://localhost:${server.address().port} · SQLite · Host: ${host}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
