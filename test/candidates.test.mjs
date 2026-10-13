import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyze, experienceYears, csvCell, electoralFor, businessAnalytics, describeCandidate } from '../public/candidate-model.js';
import { validateBatch } from '../src/schema.mjs';
import { openStore } from '../src/store.mjs';
import { createDashboardServer } from '../scripts/serve.mjs';
import { mapProfile, plainText } from '../scripts/sync-jne.mjs';

const seed = JSON.parse(await readFile(new URL('../public/candidates.json', import.meta.url), 'utf8'));
const sample = seed.candidates[0];
const reports = JSON.parse(await readFile(new URL('../public/data.json',import.meta.url),'utf8'));
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
test('las 21 fotografías locales tienen procedencia JNE y son JPEG o PNG válidos', async () => {
  assert.equal(seed.candidates.filter(c=>c.photo?.url).length,21);
  for(const candidate of seed.candidates) {
    assert.equal(candidate.photo.sourceUrl,candidate.source.url);
    assert.match(candidate.description,/declara|declarada/i);
    const image=await readFile(new URL('../public'+candidate.photo.url,import.meta.url));
    assert.ok((image[0]===0xff&&image[1]===0xd8) || image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  }
});
test('porcentajes se vinculan por cargo, partido y ámbito; faltantes no son cero',()=>{
  const niel=seed.candidates.find(c=>c.name==='NIEL BRHAM ZAVALA MEZA');
  const municipal=electoralFor(niel,reports);assert.equal(municipal.percent,28.043);assert.equal(municipal.cutoff,'06 oct 2026 · 12:46');
  assert.equal(electoralFor({...niel,scope:'Provincia de Tarata'},reports),null);
  const regional=electoralFor({...niel,role:'regional',scope:'Departamento de Tacna'},reports);assert.equal(regional.percent,29.314);
  assert.equal(electoralFor({...niel,party:'OTRA ORGANIZACIÓN'},reports),null);
});
test('indicadores BI respetan valores ausentes y agrupan ingresos por año',()=>{
  const record=(id,annualIncome,year,years)=>({...sample,id,education:[],political:[],legal:[],reviewedSections:['experience','finances'],experience:[{startYear:2020,endYear:2020+years}],finances:{annualIncome,year},electoral:null});
  const metrics=businessAnalytics([record('a',0,2025,0),record('b',100,2025,2),record('c',1000,2024,4),{...sample,id:'d',reviewedSections:[],finances:null,experience:[],electoral:null}]);
  assert.equal(metrics.total,4);assert.equal(metrics.averageExperience,2);assert.equal(metrics.experienceCount,3);
  assert.deepEqual(metrics.income,[{year:2025,count:2,median:50},{year:2024,count:1,median:1000}]);
  assert.equal(metrics.withPercent,0);assert.equal(metrics.percentCoverage,0);
  assert.equal(businessAnalytics([]).averageExperience,null);assert.equal(businessAnalytics([]).percentCoverage,null);
});
test('descripción del perfil no infiere un título concluido ni inventa cargos',()=>{
  const text=describeCandidate({...sample,education:[{level:'Posgrado',degree:'MAESTRÍA EN GESTIÓN',institution:'UNIVERSIDAD TEST',completed:false}],experience:[],political:[]});
  assert.match(text,/Declara estudios/);assert.doesNotMatch(text,/maestro|titulado/i);
  assert.match(text,/no registra empleos/);
});
test('SQLite devuelve BI de todo el filtro, ordena resultados y migra una base anterior', async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const directory=await mkdtemp(join(tmpdir(),'electoral-migration-')),path=join(directory,'legacy.sqlite');
  const old=new DatabaseSync(path);
  old.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY,name TEXT NOT NULL,party TEXT NOT NULL,role TEXT NOT NULL,search_text TEXT NOT NULL,status TEXT NOT NULL,consulted_at TEXT NOT NULL,payload TEXT NOT NULL)');
  old.prepare('INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?)').run(sample.id,sample.name,sample.party,sample.role,'test',sample.status,sample.source.consultedAt,JSON.stringify(sample));old.close();
  const store=openStore(path);
  try {
    store.import(seed);store.setReports(reports);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,2);
    const metrics=store.analytics(new URLSearchParams({role:'municipal',limit:'1',page:'7'}));
    assert.equal(metrics.total,7);assert.equal(metrics.withPercent,4);
    const ranking=store.list(new URLSearchParams({role:'municipal',sort:'votes',limit:'1'}));assert.equal(ranking.candidates[0].name,'NIEL BRHAM ZAVALA MEZA');
    assert.equal(store.list(new URLSearchParams({percentage:'reported'})).total,9);
    assert.equal(store.list(new URLSearchParams({percentage:'missing'})).total,12);
    store.import({candidates:[{...seed.candidates.find(c=>c.name==='NIEL BRHAM ZAVALA MEZA'),id:'other-scope',scope:'Provincia de Tarata'}]});
    assert.equal(store.get('other-scope').electoral,null);
  } finally {store.close();await rm(directory,{recursive:true,force:true});}
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
    assert.ok(c.description);assert.ok(c.photo.url);
    const metrics=await (await fetch(base+'/api/candidates/analytics?role=municipal&limit=1')).json();assert.equal(metrics.total,7);assert.equal(metrics.withPercent,4);
    const photograph=await fetch(base+sample.photo.url,{headers:{'Accept-Encoding':'gzip'}});assert.equal(photograph.status,200);assert.match(photograph.headers.get('content-type'),/^image\//);assert.equal(photograph.headers.get('content-encoding'),null);
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
