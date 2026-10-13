import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resultReport,resultMetrics,pairComparison,crossElection,resultsCSV} from '../public/results-model.js';

const data=JSON.parse(await readFile(new URL('../public/data.json',import.meta.url),'utf8'));
const snapshot=JSON.parse(await readFile(new URL('../public/territorial.json',import.meta.url),'utf8'));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.000001,`${actual} != ${expected}`);

test('resultados: el corte periodístico conserva sus porcentajes sin tomar votos de otra fecha',()=>{
  const report=resultReport(data,snapshot,'municipal','archive','220400'),m=resultMetrics(report);
  assert.equal(report.scope,'Provincia de Tacna');assert.equal(report.zoneCode,'220100');
  assert.equal(report.parties.length,5);assert.equal(m.leader.percent,28.043);
  assert.equal(report.validVotes,null);assert.equal(report.castVotes,null);
  assert.ok(report.parties.every(p=>p.votes===null));assert.equal(report.cutoffLabel,data.municipal.cutoff);
  near(m.listedShare,89.888);near(m.unlistedShare,10.112);near(m.gap,5.774);near(m.topTwo,50.312);
  assert.equal(report.parties[0].candidate.name,'NIEL BRHAM ZAVALA MEZA');
});
test('resultados: provincia y cargo seleccionan denominadores y candidaturas propios',()=>{
  const tacna=resultReport(data,snapshot,'municipal'),candarave=resultReport(data,snapshot,'municipal','territorial','220400'),regional=resultReport(data,snapshot,'regional');
  assert.equal(tacna.validVotes,190163);assert.equal(tacna.parties[0].percent,28.029);
  assert.equal(candarave.validVotes,3354);assert.equal(candarave.parties[0].candidate.name,'DANIEL AGAPITO ROMERO MACHACA');
  assert.equal(regional.scope,'Departamento de Tacna');assert.equal(regional.validVotes,216454);assert.equal(regional.parties.length,14);
  assert.equal(candarave.reportedAt,null);assert.equal(candarave.progress,null);assert.equal(resultMetrics(candarave).castVotes,null);
});
test('resultados: acumulados, brechas y votos válidos no se confunden con participación',()=>{
  const m=resultMetrics(resultReport(data,snapshot,'municipal'));
  near(m.ranked.at(-1).cumulative,m.listedShare);near(m.ranked[0].gapLeader,0);
  near(m.ranked[1].gapLeader,m.gap);assert.equal(m.ranked[0].gapPrevious,null);
  assert.equal(m.castVotes,222984);assert.equal(m.otherCast,32821);
  near(m.validShareOfCast,190163/222984*100);assert.equal(m.unlistedShare,null);
  const invalid=resultMetrics({...resultReport(data,snapshot,'municipal'),castVotes:1});assert.equal(invalid.castVotes,null);assert.equal(invalid.otherCast,null);
});
test('resultados: comparación de dos listas conserva signo, votos y faltantes',()=>{
  const report=resultReport(data,snapshot,'municipal'),a=report.parties[0],b=report.parties[1];
  const forward=pairComparison(report,a.name,b.name),reverse=pairComparison(report,b.name,a.name);
  near(forward.difference,-reverse.difference);assert.equal(forward.voteDifference,-reverse.voteDifference);
  assert.equal(pairComparison(report,a.name,a.name),null);assert.equal(pairComparison(report,a.name,'NO EXISTE'),null);
  assert.equal(pairComparison(resultReport(data,snapshot,'municipal','archive'),a.name,b.name).voteDifference,null);
});
test('resultados: comparación entre cargos muestra solo organizaciones compartidas y mantiene bases originales',()=>{
  const municipal=resultReport(data,snapshot,'municipal','archive'),regional=resultReport(data,snapshot,'regional','archive'),rows=crossElection(municipal,regional);
  assert.equal(rows.length,4);assert.equal(rows[0].municipal,28.043);assert.equal(rows[0].regional,29.314);
  assert.ok(!rows.some(r=>/Renovación|Progresemos/.test(r.name)));
  const fallback=resultReport(data,null,'municipal');assert.equal(fallback.sourceKind,'archive');assert.equal(fallback.parties[0].votes,null);
});
test('resultados: CSV conserva ámbito, corte, consulta, métricas y nulos en la exportación completa',()=>{
  const regional=resultReport(data,snapshot,'regional'),csv=resultsCSV(regional);
  assert.equal(csv.split('\r\n').length,15);assert.ok(csv.includes('216454'));assert.ok(csv.includes(regional.reportedAt));
  assert.ok(csv.includes('"11.684"'));assert.ok(!csv.includes('11.684000000000001'));
  const archive=resultsCSV(resultReport(data,snapshot,'municipal','archive'));
  assert.equal(archive.split('\r\n').length,6);assert.ok(archive.includes(data.municipal.cutoff));assert.ok(!archive.includes('53300'));
  const incompatible=resultsCSV(resultReport(data,snapshot,'municipal','territorial','220400'));
  assert.ok(!incompatible.includes('2026-10-05T'));assert.ok(incompatible.includes('3354'));
});
