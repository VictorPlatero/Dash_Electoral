import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {partyKey,humanize} from '../public/candidate-model.js';
import {downloadPortrait} from './portraits.mjs';

const ANDINA='https://andina.pe/agencia/',JNE='https://votoinformado.jne.gob.pe/api/v1';
const REGION='220000';
async function request(url,body) {
  const path='research/map-'+createHash('sha256').update(url+JSON.stringify(body??null)).digest('hex')+'.json';
  if(process.argv.includes('--resume'))try{const cached=JSON.parse(await readFile(path,'utf8'));if(Date.now()-cached.savedAt<86400000)return cached.data;}catch{}
  for(let attempt=0;attempt<3;attempt++) {
    try{const response=await fetch(url,{signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.error)throw new Error('Error en fuente geográfica');await mkdir('research',{recursive:true});await writeFile(path,JSON.stringify({savedAt:Date.now(),data}));return data;}
    catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
  }
}
function distance(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);}
function simplify(points,tolerance=.0008){if(points.length<5)return points;let max=0,index=0;for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}if(max>tolerance)return [...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)];return [points[0],points.at(-1)];}
function geometry(input){const polygons=input.type==='Polygon'?[input.coordinates]:input.coordinates;return {type:'MultiPolygon',coordinates:polygons.map(polygon=>polygon.map(ring=>{const reduced=simplify(ring);return (reduced.length>=4?reduced:ring).map(point=>point.map(value=>Number(value.toFixed(5))));}))};}
function query(zone,election,type){const params=new URLSearchParams({tipo:type,nivel:election==='regional'?'gobernador':'provincial',idEleccion:election==='regional'?'1':'3',tipoFiltro:zone.level==='department'?'ubigeo_nivel_01':zone.level==='province'?'ubigeo_nivel_02':'ubigeo_nivel_03',idAmbitoGeografico:'1'});if(type==='candidatos'){params.set('ubigeoNivel1',REGION);if(zone.level!=='department')params.set('ubigeoNivel2',zone.level==='province'?zone.code:zone.provinceCode);if(zone.level==='district')params.set('ubigeoNivel3',zone.code);}else{params.set('idUbigeoDepartamento',REGION);if(zone.level!=='department')params.set('idUbigeoProvincia',zone.level==='province'?zone.code:zone.provinceCode);if(zone.level==='district')params.set('idUbigeoDistrito',zone.code);}return ANDINA+'api/ResultadosMunicipales.ashx?'+params;}

export function mapReport(response,totals,zone,election,consultedAt,sourceUrl) {
  if(!response?.success || !Array.isArray(response.data) || !response.data.length || !totals?.success || !totals.data)return null;
  const metadata=totals.data;
  const correctZone=zone.level==='department'?String(metadata.idUbigeoDepartamento)===zone.code&&metadata.idUbigeoProvincia==null&&metadata.idUbigeoDistrito==null:zone.level==='province'?String(metadata.idUbigeoProvincia)===zone.code&&metadata.idUbigeoDistrito==null:String(metadata.idUbigeoDistrito)===zone.code;
  if(!correctZone)return null;
  const parties=response.data.filter(row=>typeof row.porcentajeVotosValidos==='number').map(row=>({name:row.nombreAgrupacionPolitica,percent:row.porcentajeVotosValidos,votes:row.totalVotosValidos,candidate:null}));
  if(!parties.length || parties.some(p=>!p.name || p.percent<0 || p.percent>100 || !Number.isInteger(p.votes)||p.votes<0))throw new Error('Valores electorales inválidos en '+zone.name);
  const validVotes=parties.reduce((sum,p)=>sum+p.votes,0);
  if(!validVotes || parties.some(p=>Math.abs(p.votes/validVotes*100-p.percent)>.002))return null;
  const totalsCompatible=validVotes===metadata.totalVotosValidos;
  return {election,zoneCode:zone.code,zoneLevel:zone.level,scopeCode:election==='regional'?REGION:zone.level==='province'?zone.code:zone.provinceCode,parties:parties.sort((a,b)=>b.percent-a.percent),validVotes,castVotes:totalsCompatible?metadata.totalVotosEmitidos:null,progress:totalsCompatible?metadata.actasContabilizadas:null,reportedAt:totalsCompatible?metadata.fechaActualizacion||null:null,totalsCompatible,consultedAt,sourceName:'Andina · datos atribuidos a ONPE',sourceUrl};
}

async function sync(){
  const consultedAt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const catalog=await request(ANDINA+'js/geo/ubigeo_onpe.json'),index=await request(ANDINA+'js/geo/onpe_indice.json');
  const provinceRows=catalog.prov[REGION];if(provinceRows?.length!==4)throw new Error('No se recibieron las cuatro provincias de Tacna');
  const rawProvince=await request(ANDINA+'js/geo/'+index.provincias[REGION]);
  const districts=[];for(const [code] of provinceRows){const raw=await request(ANDINA+'js/geo/'+index.distritos[code]);for(const feature of raw.features){const row=catalog.dist[code].find(item=>item[0]===String(feature.properties.ID));if(!row)throw new Error('Distrito sin correspondencia de código');districts.push({type:'Feature',properties:{code:row[0],name:humanize(row[1]),level:'district',provinceCode:code,provinceName:humanize(provinceRows.find(p=>p[0]===code)[1]),ineiCode:row[2]||null},geometry:geometry(feature.geometry)});}}
  const provinces=rawProvince.features.map(feature=>{const row=provinceRows.find(p=>p[0]===String(feature.properties.ID));if(!row)throw new Error('Provincia sin correspondencia');return {type:'Feature',properties:{code:row[0],name:humanize(row[1]),level:'province',provinceCode:row[0],provinceName:humanize(row[1]),ineiCode:row[2]},geometry:geometry(feature.geometry)};});
  if(districts.length!==28)throw new Error('No se recibieron los 28 distritos');
  const department={type:'Feature',properties:{code:REGION,name:'Departamento de Tacna',level:'department',provinceCode:null,ineiCode:'23'},geometry:{type:'MultiPolygon',coordinates:provinces.flatMap(p=>p.geometry.coordinates)}};
  const reports=[],unavailable=[],zones=[department,...provinces,...districts].map(feature=>feature.properties);
  const tasks=zones.flatMap(zone=>['regional','municipal'].filter(election=>election==='regional'||zone.level!=='department').map(election=>({zone,election})));
  await Promise.all(Array.from({length:3},async()=>{while(tasks.length){const {zone,election}=tasks.shift();await new Promise(resolve=>setTimeout(resolve,200));const sourceUrl=query(zone,election,'candidatos');const response=await request(sourceUrl);if(response.success!==true)throw new Error('La consulta electoral falló');let report=null;if(Array.isArray(response.data)&&response.data.length)report=mapReport(response,await request(query(zone,election,'totales')),zone,election,consultedAt,sourceUrl);if(report)reports.push(report);else unavailable.push({election,zoneCode:zone.code,zoneLevel:zone.level,reason:'La consulta no devuelve un desglose validable para este ámbito.'});}}));
  const candidateFile=JSON.parse(await readFile('public/candidates.json','utf8'));
  for(const report of reports) for(const party of report.parties){const candidate=candidateFile.candidates.find(c=>c.role===report.election&&partyKey(c.party)===partyKey(party.name)&&(report.election==='regional'||report.scopeCode==='220100'));if(candidate)party.candidate={id:candidate.id,name:candidate.name,sourceUrl:candidate.source.url,photo:candidate.photo};}
  // Resolve other provincial leaders from JNE, never re-use Tacna's candidate for
  // a party's different candidacy in Candarave, Tarata or Jorge Basadre.
  for(const report of reports.filter(r=>r.election==='municipal'&&r.zoneLevel==='province'&&r.zoneCode!=='220100')){
    const province=report.zoneCode.slice(2,4),location={dep:'22',pro:province,dis:null},lists=await request(JNE+'/candidatos/organizaciones',location);
    const org=lists.data?.find(e=>e.idTipoEleccion===5)?.organizaciones.find(org=>partyKey(org.organizacionPolitica)===partyKey(report.parties[0].name));
    if(org){const roster=await request(JNE+'/candidatos/organizaciones/candidatos',{...location,idSolicitudLista:org.listas[0].idSolicitudLista});const head=roster.data?.flatMap(e=>e.organizaciones.flatMap(o=>o.listas.flatMap(l=>l.candidatos||[]))).find(c=>c.cargoEleccion==='ALCALDE PROVINCIAL');if(head?.idHojaVida){const sourceUrl='https://votoinformado.jne.gob.pe/candidatos/hoja-vida/'+head.idHojaVida;const photo=await downloadPortrait(head.urlFotoCandidato,head.idHojaVida,sourceUrl,consultedAt);report.parties[0].candidate={id:head.idHojaVida,name:[head.nombres,head.apellidoPaterno,head.apellidoMaterno].filter(Boolean).join(' '),sourceUrl,photo};}}
  }
  const output={schemaVersion:1,consultedAt,source:{name:'Agencia Andina · datos atribuidos a ONPE',url:ANDINA+'embedresultadosmunicipales2026.aspx?dep=220000&nivel=provincial&widget=1'},geometrySource:{name:'Geometría ONPE distribuida por Andina; límites referenciales',url:ANDINA+'js/geo/onpe_indice.json',referenceUrl:'https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ZEE_VISOR/07_CARTOGRAF%C3%8DA_BASE_TACNA/MapServer/12',note:'El MINAM consultado contiene 27 distritos. Se utiliza la geometría distribuida por Andina que incluye los 28, incluida La Yarada Los Palos. Los códigos ONPE y los códigos INEI son distintos y se conservan por separado.'},geography:{type:'FeatureCollection',features:[department,...provinces,...districts]},reports:reports.sort((a,b)=>(a.election+a.zoneCode).localeCompare(b.election+b.zoneCode)),unavailable:unavailable.sort((a,b)=>(a.election+a.zoneCode).localeCompare(b.election+b.zoneCode))};
  await writeFile('public/territorial.json.tmp',JSON.stringify(output)+'\n');await rename('public/territorial.json.tmp','public/territorial.json');console.log(JSON.stringify({provinces:provinces.length,districts:districts.length,reports:reports.length,unavailable:unavailable.length,leaders:reports.filter(r=>r.election==='municipal').map(r=>({zone:r.zoneCode,leader:r.parties[0].candidate?.name}))}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await sync();
