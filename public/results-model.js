import {partyKey,csvCell} from './candidate-model.js';

export function resultReport(data,snapshot,election,source='territorial',zoneCode='220100') {
  const zone=election==='regional'?'220000':zoneCode;
  const territorial=snapshot?.reports.find(r=>r.election===election&&r.zoneCode===zone&&r.zoneLevel===(election==='regional'?'department':'province'));
  if(source==='territorial'&&territorial) {
    const area=snapshot.geography.features.find(f=>f.properties.code===zone)?.properties.name;
    return {...territorial,title:data[election].title,scope:election==='regional'?'Departamento de Tacna':'Provincia de '+area,complete:true,sourceKind:'territorial'};
  }
  const archive=data[election],provenance=data.sources.find(s=>s.id===archive.source);
  const tacna=snapshot?.reports.find(r=>r.election===election&&r.zoneCode===(election==='regional'?'220000':'220100'));
  return {election,title:archive.title,scope:archive.scope,zoneCode:election==='regional'?'220000':'220100',parties:archive.parties.map(p=>({...p,votes:null,candidate:tacna?.parties.find(t=>partyKey(t.name)===partyKey(p.name))?.candidate||null})),progress:archive.reportedProgress,validVotes:null,castVotes:null,reportedAt:null,cutoffLabel:archive.cutoff,consultedAt:data.resultsResearched,sourceName:provenance.name,sourceUrl:provenance.url,complete:false,sourceKind:'archive',totalsCompatible:null};
}

export function resultMetrics(report) {
  const parties=[...report.parties].sort((a,b)=>b.percent-a.percent);
  const listedShare=parties.reduce((sum,p)=>sum+p.percent,0);
  let cumulative=0;
  const ranked=parties.map((p,index)=>{cumulative+=p.percent;return {...p,rank:index+1,gapLeader:parties[0].percent-p.percent,gapPrevious:index?parties[index-1].percent-p.percent:null,cumulative};});
  const valid=Number.isInteger(report.validVotes)&&report.validVotes>0?report.validVotes:null;
  const cast=report.totalsCompatible===true&&Number.isInteger(report.castVotes)&&valid!=null&&report.castVotes>=valid?report.castVotes:null;
  return {ranked,listedShare,unlistedShare:report.complete?null:Math.max(0,100-listedShare),leader:ranked[0],gap:ranked.length>1?ranked[0].percent-ranked[1].percent:null,topTwo:ranked.slice(0,2).reduce((s,p)=>s+p.percent,0),topThree:ranked.slice(0,3).reduce((s,p)=>s+p.percent,0),validVotes:valid,castVotes:cast,otherCast:cast==null?null:cast-valid,validShareOfCast:cast==null?null:valid/cast*100};
}

export function pairComparison(report,leftName,rightName) {
  const left=report.parties.find(p=>partyKey(p.name)===partyKey(leftName)),right=report.parties.find(p=>partyKey(p.name)===partyKey(rightName));
  if(!left||!right||partyKey(left.name)===partyKey(right.name))return null;
  return {left,right,difference:left.percent-right.percent,voteDifference:Number.isInteger(left.votes)&&Number.isInteger(right.votes)?left.votes-right.votes:null};
}

export function crossElection(municipal,regional) {
  return municipal.parties.flatMap(p=>{const r=regional.parties.find(r=>partyKey(r.name)===partyKey(p.name));return r?[{name:p.name,municipal:p.percent,regional:r.percent}]:[];});
}

export function resultsCSV(report) {
  const {ranked}=resultMetrics(report);
  const decimal=value=>value==null?null:Number(value.toFixed(3));
  const rows=[['cargo','ambito','posicion_en_reporte','organizacion','candidato_jne','porcentaje_votos_validos','votos_lista','diferencia_con_primera_pp','diferencia_con_anterior_pp','acumulado_listas_pp','total_votos_validos','total_votos_emitidos','avance_actas_porcentaje','corte','consulta','fuente','alcance'],...ranked.map(p=>[report.title,report.scope,p.rank,p.name,p.candidate?.name,p.percent,p.votes,decimal(p.gapLeader),decimal(p.gapPrevious),decimal(p.cumulative),report.validVotes,report.castVotes,report.progress,report.cutoffLabel||report.reportedAt,report.consultedAt,report.sourceUrl,report.complete?'Listado validado completo; reporte parcial':'Solo organizaciones publicadas; reporte parcial'])];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
