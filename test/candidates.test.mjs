import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyze, experienceYears, csvCell } from '../public/candidate-model.js';
import { validateBatch } from '../src/schema.mjs';
import { openStore } from '../src/store.mjs';
import { createDashboardServer } from '../scripts/serve.mjs';
import { mapProfile, plainText } from '../scripts/sync-jne.mjs';

const seed = JSON.parse(await readFile(new URL('../public/candidates.json', import.meta.url), 'utf8'));
const sample = seed.candidates[0];
const job = (startYear, endYear) => ({ startYear, endYear });

test('experiencia une empleos solapados, limita el corte y omite fechas incompletas', () => {
  assert.equal(experienceYears([job(2010,2018), job(2014,2020), job(2023,2030), job(2025,2025), job(null,2020)]), 13);
  assert.equal(experienceYears([job(2028,2030),job(2024,2020)]), 0);
  assert.equal(experienceYears([job(2000,2004),job(2004,2007)]),7);
});
test('datos ausentes no se convierten en cero ni en ausencia de antecedentes', () => {
  const partial = analyze({ education:[],experience:[],legal:[],reviewedSections:[] });
  assert.equal(partial.years,null); assert.equal(partial.income,null); assert.equal(partial.judicialRecords,null); assert.equal(partial.coverage,0);
  const declared = analyze({ education:[],experience:[],legal:[],reviewedSections:['legal','experience'] });
  assert.equal(declared.years,0); assert.equal(declared.judicialRecords,0); assert.equal(declared.coverage,40);
});
test('la ficha con absolución conserva el fallo y genera una aclaración', () => {
  const c = seed.candidates.find(c => c.name === 'EDGAR ROGELIO CONCORI COAQUIRA');
  const a = analyze(c); assert.equal(a.acquittals,1); assert.equal(a.judicialRecords,1);
  assert.match(a.warnings.join(' '),/absolución/); assert.equal(c.legal[0].outcome,'ABSUELTO');
});
test('el catálogo conserva ámbito, fuentes HTTPS y secciones revisadas', () => {
  const candidates = validateBatch(seed);
  assert.equal(candidates.length,21);
  assert.equal(candidates.filter(c => c.role === 'municipal').length,7);
  assert.equal(candidates.filter(c => c.role === 'regional').length,14);
  assert.equal(seed.unavailableLists.length,2);
  for (const c of candidates) {
    assert.match(c.source.url,/^https:\/\/votoinformado\.jne\.gob\.pe\//);
    assert.equal(analyze(c).coverage,100);
    assert.ok(!Object.hasOwn(c,'dni'));
  }
});
test('el importador rechaza fechas imposibles, URLs ejecutables y lotes duplicados', () => {
  for (const source of [{...sample.source,url:'javascript:alert(1)'},{...sample.source,consultedAt:'2026-02-30'}]) assert.throws(() => validateBatch({candidates:[{...sample,source}]}));
  assert.throws(() => validateBatch({candidates:[sample,sample]}), /duplicados/);
  assert.throws(() => validateBatch({candidates:[{...sample,additional:{}}]}), /additional/);
});
test('el mapeo JNE conserva fechas partidarias y no acepta otra circunscripción', () => {
  const raw = { datoGeneral:{idHojaVida:'test',cargo:'ALCALDE PROVINCIAL',postulaDepartamento:'TACNA',postulaProvincia:'TACNA',nombres:'PRUEBA',apellidoPaterno:'TEST',organizacionPolitica:'TEST'},trayectoria:{cargoPartidario:[{cargoPartidario:'PRESIDENTE',orgPolCargoPartidario:'TEST',anioCargoPartiDesde:'2020',anioCargoPartiHasta:'2022'}]} };
  const c = mapProfile(raw,{},'2026-10-13'); assert.equal(c.political[0].startYear,2020); assert.equal(c.political[0].endYear,2022); assert.equal(analyze(c).judicialRecords,null);
  assert.throws(() => mapProfile({...raw,datoGeneral:{...raw.datoGeneral,postulaProvincia:'TARATA'}},{},'2026-10-13'),/ámbito/);
});
test('CSV neutraliza fórmulas y conserva comillas', () => {
  assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('Nombre, apellido'),'"Nombre, apellido"');
});
test('las anotaciones marginales se convierten en texto sin ejecutar HTML', () => {
  assert.equal(plainText('<p><b>FALLO</b><br/>ABSUELTO &amp;NBSP; &#x2713;</p><script>alert(1)</script>'), 'FALLO\nABSUELTO ✓');
});
test('SQLite persiste, actualiza sin duplicar y rechaza un lote completo sin cambios', async () => {
  const directory = await mkdtemp(join(tmpdir(),'electoral-db-')), path = join(directory,'test.sqlite');
  let store = openStore(path);
  try {
    store.import({candidates:[sample]});
    assert.throws(() => store.import({candidates:[{...sample,name:'NO GUARDAR'},{...sample,id:'bad',role:'invalid'}]}));
    assert.equal(store.get(sample.id).name,sample.name);
    store.import({candidates:[{...sample,name:'ACTUALIZADO'}]}); store.close(); store = openStore(path);
    assert.equal(store.get(sample.id).name,'ACTUALIZADO'); assert.equal(store.all().length,1);
    assert.equal(store.db.prepare('SELECT count(*) n FROM education').get().n,sample.education.length);
    assert.equal(store.list(new URLSearchParams({q:"' OR 1=1 --"})).total,0);
    assert.equal(store.list(new URLSearchParams({q:'%'})).total,0);
  } finally { store.close(); await rm(directory,{recursive:true,force:true}); }
});
test('API: filtros, paginación, exportación completa, validación, autorización y caché', async () => {
  const server = await createDashboardServer({root:resolve('public'),dbPath:':memory:',adminToken:'test-key'});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const meta = await (await fetch(base+'/api/candidates/meta')).json(); assert.equal(meta.total,21); assert.equal(meta.canWrite,false);
    const municipal = await (await fetch(base+'/api/candidates?role=municipal&limit=2&page=2')).json(); assert.equal(municipal.total,7); assert.equal(municipal.candidates.length,2); assert.equal(municipal.page,2);
    const regional = await (await fetch(base+'/api/candidates?role=regional&limit=10000')).json(); assert.equal(regional.candidates.length,14); assert.equal(regional.limit,50);
    const c = await (await fetch(base+'/api/candidates/'+sample.id)).json(); assert.equal(c.name,sample.name); assert.equal(c.analysis.coverage,100);
    assert.equal((await fetch(base+'/api/candidates/unknown')).status,404);
    const csv = await (await fetch(base+'/api/candidates/export?role=municipal&limit=1')).text(); assert.equal(csv.split('\r\n').length,8);
    const backup = await (await fetch(base+'/api/candidates/backup')).json(); assert.equal(validateBatch(backup).length,21);
    const options = {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidates:[sample]})};
    assert.equal((await fetch(base+'/api/candidates/import',options)).status,401);
    options.headers.Authorization = 'Bearer test-key';
    assert.equal((await fetch(base+'/api/candidates/import',{...options,headers:{...options.headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(base+'/api/candidates/import',{...options,body:'not json'})).status,400);
    assert.equal((await fetch(base+'/api/candidates/import',{...options,body:JSON.stringify({candidates:[{...sample,additional:{}}]})})).status,400);
    assert.equal((await fetch(base+'/api/candidates/import',options)).status,200);
    assert.equal((await (await fetch(base+'/api/candidates/meta')).json()).total,21);
    const asset = await fetch(base+'/styles.css'); const etag = asset.headers.get('etag'); assert.ok(etag); assert.ok(asset.headers.get('content-security-policy'));
    assert.equal((await fetch(base+'/styles.css',{headers:{'If-None-Match':etag}})).status,304);
    const gzip = await fetch(base+'/candidates.json',{headers:{'Accept-Encoding':'gzip'}}); assert.equal(gzip.headers.get('content-encoding'),'gzip');
    assert.equal((await fetch(base+'/%E0%A4%A')).status,404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
