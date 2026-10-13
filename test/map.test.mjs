import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {partyKey} from '../public/candidate-model.js';
import {compatibleReport,supportByZone,comparableMaximum,polygonPath,projection,territorialCSV} from '../public/map-model.js';
import {mapReport} from '../scripts/sync-map.mjs';

const snapshot=JSON.parse(await readFile(new URL('../public/territorial.json',import.meta.url),'utf8'));
const zones=snapshot.geography.features.map(feature=>feature.properties);
const provinces=zones.filter(zone=>zone.level==='province');

test('el mapa conserva cuatro provincias, 28 distritos y códigos ONPE distintos de INEI',()=>{
  assert.equal(provinces.length,4);assert.equal(zones.filter(zone=>zone.level==='district').length,28);
  assert.equal(new Set(zones.map(zone=>zone.code)).size,33);
  assert.ok(zones.find(zone=>zone.name==='La Yarada Los Palos'));
  assert.equal(zones.find(zone=>zone.code==='220100').ineiCode,'2301');
  assert.equal(zones.find(zone=>zone.code==='220200').ineiCode,'2304');
});
test('un resultado provincial nunca se utiliza como apoyo distrital',()=>{
  const district=zones.find(zone=>zone.level==='district'&&zone.provinceCode==='220100');
  assert.equal(compatibleReport(snapshot,'municipal',district),null);
  const rows=supportByZone(snapshot,'municipal',[district]);assert.equal(rows[0].available,false);assert.equal(rows[0].party,null);
  assert.equal(compatibleReport(snapshot,'regional',provinces[0]),null);
});
test('Niel Zavala no recibe el porcentaje de otra candidatura de APP en Candarave',()=>{
  const candidate={role:'municipal',scopeCode:'220100',party:'ALIANZA PARA EL PROGRESO'};
  const rows=supportByZone(snapshot,'municipal',provinces,'',candidate);
  const tacna=rows.find(row=>row.zone.code==='220100'),candarave=rows.find(row=>row.zone.code==='220400');
  assert.equal(tacna.available,true);assert.equal(tacna.party.candidate.name,'NIEL BRHAM ZAVALA MEZA');
  assert.equal(candarave.eligible,false);assert.equal(candarave.party,null);
  assert.equal(comparableMaximum(rows,candidate),null);
  const across=supportByZone(snapshot,'municipal',provinces,'ALIANZA PARA EL PROGRESO');
  assert.equal(across.find(row=>row.zone.code==='220400').party.candidate.name,'DANIEL AGAPITO ROMERO MACHACA');
});
test('los reportes validados conservan porcentaje y votos coherentes; votos blancos no son listas',()=>{
  assert.equal(snapshot.reports.length,5);
  for(const report of snapshot.reports){
    assert.equal(report.parties.reduce((sum,p)=>sum+p.votes,0),report.validVotes);
    for(const party of report.parties){assert.ok(Math.abs(party.votes/report.validVotes*100-party.percent)<.002);assert.ok(!/votos (nulos|en blanco)/.test(partyKey(party.name)));}
    assert.match(report.sourceUrl,/^https:\/\/andina\.pe\/agencia\/api\//);
  }
  const candarave=snapshot.reports.find(r=>r.election==='municipal'&&r.zoneCode==='220400');
  assert.equal(candarave.totalsCompatible,false);assert.equal(candarave.reportedAt,null);assert.equal(candarave.progress,null);
});
test('la zona de mayor apoyo exige la misma elección, nivel y corte, sin inventar datos ausentes',()=>{
  const candidate={role:'municipal',scopeCode:'220100',party:'APP'};
  const row=(code,percent,scopeCode='220100',reportedAt='2026-10-06T12:00:00Z')=>({zone:{code,level:'district'},available:true,eligible:true,party:{percent},report:{scopeCode,reportedAt}});
  assert.equal(comparableMaximum([row('a',10)],candidate),null);
  assert.equal(comparableMaximum([row('a',10),row('b',20)],candidate).zone.code,'b');
  assert.equal(comparableMaximum([row('a',10),row('b',20,'220400')],candidate),null);
  assert.equal(comparableMaximum([row('a',10),row('b',20,'220100','2026-10-05T12:00:00Z')],candidate),null);
  assert.equal(comparableMaximum([row('a',10,'220100',null),row('b',20,'220100',null)],candidate),null);
});
test('el importador rechaza un resumen que corresponde a otra zona y separa un corte incompatible',()=>{
  const zone={code:'220100',level:'province',name:'Tacna'},response={success:true,data:[{nombreAgrupacionPolitica:'APP',porcentajeVotosValidos:60,totalVotosValidos:60},{nombreAgrupacionPolitica:'OTRA',porcentajeVotosValidos:40,totalVotosValidos:40}]};
  const totals={success:true,data:{idUbigeoProvincia:220100,idUbigeoDistrito:null,totalVotosValidos:100,fechaActualizacion:'2026-10-05T12:00:00Z',actasContabilizadas:90}};
  assert.equal(mapReport(response,{...totals,data:{...totals.data,idUbigeoProvincia:220200}},zone,'municipal','2026-10-13','https://andina.pe/example'),null);
  const incompatible=mapReport(response,{...totals,data:{...totals.data,totalVotosValidos:200}},zone,'municipal','2026-10-13','https://andina.pe/example');
  assert.equal(incompatible.validVotes,100);assert.equal(incompatible.reportedAt,null);assert.equal(incompatible.progress,null);
  assert.equal(mapReport({success:true,data:null},totals,zone,'municipal','2026-10-13','https://andina.pe/example'),null);
});
test('geometrías locales generan rutas SVG finitas y fotos de líderes con fuente JNE',async()=>{
  const project=projection(snapshot.geography.features.filter(f=>f.properties.level==='province'));
  for(const feature of snapshot.geography.features){const path=polygonPath(feature.geometry,project);assert.match(path,/^M/);assert.ok(!/NaN|Infinity|undefined/.test(path));}
  for(const report of snapshot.reports.filter(r=>r.election==='municipal')){
    const candidate=report.parties[0].candidate;assert.ok(candidate.name);assert.match(candidate.sourceUrl,/^https:\/\/votoinformado\.jne\.gob\.pe\//);
    assert.ok((await readFile(new URL('../public'+candidate.photo.url,import.meta.url))).length>100);
  }
});
test('exportación conserva vacíos para zonas sin desglose y no confunde consultas con cortes',()=>{
  const rows=supportByZone(snapshot,'regional',provinces);
  assert.equal(rows.filter(row=>row.available).length,0);
  const csv=territorialCSV(rows,'regional');assert.equal(csv.split('\r\n').length,5);assert.ok(!csv.includes('29.314'));
});
