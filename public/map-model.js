import {partyKey,csvCell} from './candidate-model.js';

export function compatibleReport(snapshot,election,zone) {
  return snapshot.reports.find(report=>report.election===election && report.zoneCode===zone.code && report.zoneLevel===zone.level && (election==='regional'?report.scopeCode==='220000':report.scopeCode===(zone.level==='province'?zone.code:zone.provinceCode))) || null;
}
export function zoneSupport(snapshot,election,zone,organization='') {
  const report=compatibleReport(snapshot,election,zone);
  if(!report)return {available:false,report:null,party:null};
  const parties=[...report.parties].sort((a,b)=>b.percent-a.percent);
  const party=organization?parties.find(p=>partyKey(p.name)===partyKey(organization)):parties[0];
  return {available:party!=null,report,party:party || null};
}
export function supportByZone(snapshot,election,zones,organization='',candidate=null) {
  return zones.map(zone=>{
    const eligible=!candidate || (candidate.role===election && (election==='regional'?candidate.scopeCode==='220000':candidate.scopeCode===(zone.level==='province'?zone.code:zone.provinceCode)));
    const support=eligible?zoneSupport(snapshot,election,zone,candidate?.party || organization):{available:false,report:null,party:null};
    return {zone,eligible,...support};
  });
}
export function comparableMaximum(rows,candidate) {
  if(!candidate)return null;
  const available=rows.filter(row=>row.available&&row.eligible);
  // A single total is not evidence of which subarea supports a candidate most.
  if(available.length<2)return null;
  const scopes=new Set(available.map(row=>row.report.scopeCode));
  const levels=new Set(available.map(row=>row.zone.level));
  const dates=new Set(available.map(row=>row.report.reportedAt));
  if(scopes.size!==1 || levels.size!==1 || dates.size!==1 || !available[0].report.reportedAt)return null;
  return available.sort((a,b)=>b.party.percent-a.party.percent)[0];
}
export function polygonPath(geometry,project) {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.flatMap(polygon=>polygon.map(ring=>ring.map((point,index)=>{const [x,y]=project(point);return (index?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);}).join(' ')+' Z')).join(' ');
}
export function projection(features,width=760,height=580,padding=38) {
  const coordinates=features.flatMap(feature=>feature.geometry.coordinates.flat(Infinity)).filter(Number.isFinite);
  const points=[];for(let i=0;i<coordinates.length;i+=2)points.push([coordinates[i],coordinates[i+1]]);
  const latitude=points.reduce((sum,p)=>sum+p[1],0)/points.length,ratio=Math.cos(latitude*Math.PI/180);
  const minX=Math.min(...points.map(p=>p[0]*ratio)),maxX=Math.max(...points.map(p=>p[0]*ratio));
  const minY=Math.min(...points.map(p=>-p[1])),maxY=Math.max(...points.map(p=>-p[1]));
  const scale=Math.min((width-padding*2)/(maxX-minX),(height-padding*2)/(maxY-minY));
  const offsetX=(width-(maxX-minX)*scale)/2,offsetY=(height-(maxY-minY)*scale)/2;
  return point=>[offsetX+(point[0]*ratio-minX)*scale,offsetY+(-point[1]-minY)*scale];
}
export function featureCenter(feature,project) {
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  let largest=polygons[0][0],area=0;
  for(const polygon of polygons){const ring=polygon[0];let value=0;for(let i=0;i<ring.length-1;i++)value+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];if(Math.abs(value)>area){area=Math.abs(value);largest=ring;}}
  const points=largest.map(project);return [points.reduce((sum,p)=>sum+p[0],0)/points.length,points.reduce((sum,p)=>sum+p[1],0)/points.length];
}
export function partyColor(name) {
  const key=partyKey(name),known={'alianza para el progreso':'#df9a27','ahora nacion an':'#1b577b','podemos peru':'#7852a1','progresemos':'#27856c','movimiento independiente regional fuerza tacna':'#a85358'};
  if(known[key])return known[key];
  const colors=['#4577ac','#ac5a6b','#3b918f','#af7b41','#797b32'];let hash=0;for(const c of key)hash=(hash*31+c.charCodeAt(0))>>>0;return colors[hash%colors.length];
}
export function intensity(percent) {
  const scale=['#e8f1f8','#bcd3e6','#80adcf','#4e87b0','#205678'];
  return scale[Math.min(4,Math.floor(Math.max(0,percent)/10))];
}
export function territorialCSV(rows,election) {
  const table=[['cargo','zona','nivel','codigo_onpe','organizacion','candidato_jne','porcentaje_votos_validos','votos_lista','total_votos_validos','avance_actas','fecha_fuente','consulta','fuente'],...rows.map(row=>[election,row.zone.name,row.zone.level,row.zone.code,row.party?.name,row.party?.candidate?.name,row.party?.percent,row.party?.votes,row.report?.validVotes,row.report?.progress,row.report?.reportedAt,row.report?.consultedAt,row.report?.sourceUrl])];
  return '\uFEFF'+table.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
