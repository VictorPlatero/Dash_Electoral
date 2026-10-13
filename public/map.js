import {humanize,partyKey} from './candidate-model.js';
import {compatibleReport,supportByZone,comparableMaximum,projection,polygonPath,featureCenter,partyColor,intensity,territorialCSV} from './map-model.js';

const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const number=(value,digits=3)=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:digits}).format(value);
const pct=value=>value==null?'No disponible':number(value)+'%';
const date=value=>value?new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value)):'No indicado por la fuente';
let snapshot,candidates=[],ready,bound=false,selected='220100',rows=[],viewport={x:0,y:0,width:760,height:580},svg,drag,suppressClick=false;
function el(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!=null)element.textContent=text;return element;}
function shape(tag,attrs={},text){const element=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,value);if(text!=null)element.textContent=text;return element;}
function button(text,action,className='button outline'){const node=el('button',className,text);node.type='button';node.addEventListener('click',action);return node;}
function link(text,url){const node=el('a','text-link',text);node.href=url;node.target='_blank';node.rel='noopener noreferrer';return node;}
function candidate(){return candidates.find(c=>c.id===$('map-candidate').value)||null;}
function election(){return $('map-election').value;}
function level(){return $('map-level').value;}
function resetView(){viewport={x:0,y:0,width:760,height:580};}
function setView(){if(svg)svg.setAttribute('viewBox',`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);$('map-zoom-out').disabled=viewport.width>=760;$('map-zoom-in').disabled=viewport.width<=760/6;}
function zoom(factor){const width=Math.min(760,Math.max(760/6,viewport.width/factor)),height=width*580/760;viewport={x:viewport.x+(viewport.width-width)/2,y:viewport.y+(viewport.height-height)/2,width,height};setView();}
function choose(code){selected=code;render();}
function photo(c){if(!c?.photo?.url)return null;const image=el('img','map-candidate-photo');image.src=c.photo.url;image.alt='Fotografía de '+humanize(c.name)+' · JNE';image.width=68;image.height=86;image.loading='lazy';image.addEventListener('error',()=>image.remove());return image;}
function options(){
  const role=election(),previous=$('map-candidate').value;
  $('map-candidate').replaceChildren(new Option('Todos los candidatos / listas', ''),...candidates.filter(c=>c.role===role&&c.scopeCode).sort((a,b)=>a.name.localeCompare(b.name,'es')).map(c=>new Option(humanize(c.name),c.id)));
  if(candidates.some(c=>c.id===previous&&c.role===role))$('map-candidate').value=previous;
  const organization=$('map-party').value,parties=[...new Set(snapshot.reports.filter(r=>r.election===role).flatMap(r=>r.parties.map(p=>p.name)))].sort();
  $('map-party').replaceChildren(new Option('Primera lista reportada', ''),...parties.map(p=>new Option(humanize(p),p)));
  if(parties.includes(organization))$('map-party').value=organization;
  $('map-level').querySelector('option[value="department"]').disabled=role!=='regional';
}
function territoryFeatures(){return snapshot.geography.features.filter(f=>f.properties.level===level()&&(level()!=='district'||!$('map-province').value||f.properties.provinceCode===$('map-province').value));}
function render(){
  const features=territoryFeatures(),person=candidate();
  rows=supportByZone(snapshot,election(),features.map(f=>f.properties),$('map-party').value,person);
  if(!rows.some(row=>row.zone.code===selected))selected=rows.find(row=>row.available)?.zone.code || rows[0]?.zone.code;
  $('map-zone').replaceChildren(...rows.map(row=>new Option(row.zone.name+(row.zone.level==='district'?' · '+row.zone.provinceName:''),row.zone.code)));$('map-zone').value=selected;
  const available=rows.filter(row=>row.available).length;
  const maximum=comparableMaximum(rows,person);
  $('map-metrics').replaceChildren(...[
    [String(rows.length),'Zonas visibles',level()==='department'?'Departamento':'Límites referenciales'],
    [`${available}/${rows.length}`,'Zonas con resultado','Para el cargo y selección actuales'],
    [maximum?maximum.zone.name:person?'Sin desglose comparable':'Selecciona un candidato','Mayor apoyo observado',maximum?pct(maximum.party.percent):'Se requiere más de una zona de su misma elección']
  ].map(([value,label,note])=>{const tile=el('article','map-metric');tile.append(el('strong','',value),el('span','',label),el('small','',note));return tile;}));
  $('map-filter-note').textContent=person?`${humanize(person.name)} · ${person.role==='regional'?'Gobierno regional':'Alcaldía de '+(person.scope||'Provincia de Tacna').replace(/^Provincia de /,'')}. Los porcentajes de otras candidaturas de su partido no se le atribuyen.`:election()==='municipal'?'Cada provincia elige una alcaldía distinta. El color identifica su primera lista reportada; al filtrar una organización se comparan listas diferentes de esa organización.':'Los datos regionales disponibles son del departamento completo. Selecciona provincias o distritos para comprobar la disponibilidad del desglose.';
  $('map-export').disabled=!rows.length;
  $('map-province').disabled=level()!=='district';
  renderSVG(features);renderLegend();renderDetails();
}
function renderSVG(features){
  const project=projection(snapshot.geography.features.filter(f=>f.properties.level==='province'));
  svg=shape('svg',{viewBox:`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`,class:'tacna-map-svg',role:'group','aria-label':'Mapa interactivo de Tacna. Selecciona una zona o utiliza el selector de zona.'});
  svg.append(shape('title',{},'Mapa electoral de Tacna'),shape('desc',{},'Polígonos referenciales seleccionables por teclado. Las zonas rayadas no tienen datos compatibles; no representan cero votos.'));
  const defs=shape('defs'),pattern=shape('pattern',{id:'map-no-data',width:7,height:7,patternUnits:'userSpaceOnUse'});pattern.append(shape('rect',{width:7,height:7,fill:'#edf1f4'}),shape('path',{d:'M-2 2 L2 -2 M0 7 L7 0 M5 9 L9 5',stroke:'#c6d0d8','stroke-width':1}));defs.append(pattern);svg.append(defs);
  svg.append(shape('rect',{x:-760,y:-580,width:2280,height:1740,fill:'#f5f9fc'}));
  for(const feature of features){const row=rows.find(row=>row.zone.code===feature.properties.code),isSelected=selected===row.zone.code;
    const fill=!row.available?'url(#map-no-data)':$('map-party').value||candidate()?intensity(row.party.percent):partyColor(row.party.name);
    const path=shape('path',{d:polygonPath(feature.geometry,project),fill,class:'territory-path'+(isSelected?' selected':''),tabindex:0,role:'button','aria-pressed':String(isSelected),'aria-label':`${row.zone.level==='province'?'Provincia':row.zone.level==='district'?'Distrito':'Región'} ${row.zone.name}: ${row.available?humanize(row.party.name)+' '+pct(row.party.percent):'sin desglose disponible'}. Seleccionar zona.`,'data-zone':row.zone.code});
    path.append(shape('title',{},row.zone.name+' · '+(row.available?humanize(row.party.name)+' · '+pct(row.party.percent):row.eligible?'Desglose no disponible':'Fuera del ámbito de esta candidatura')));
    path.addEventListener('click',()=>{if(!suppressClick)choose(row.zone.code);});path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(row.zone.code);}});svg.append(path);
    if(level()!=='district'||features.length<=11){const [x,y]=featureCenter(feature,project);const label=shape('text',{x,y,class:'territory-label','text-anchor':'middle','pointer-events':'none'});const names=row.zone.name==='Jorge Basadre'?['Jorge','Basadre']:row.zone.name==='Departamento de Tacna'?['Tacna']:row.zone.name.split(' ').length>3?row.zone.name.split(' ').slice(0,3):[row.zone.name];names.forEach((name,index)=>label.append(shape('tspan',{x,dy:index?'1.1em':0},name)));svg.append(label);}
  }
  svg.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,original:{...viewport},moved:false,code:event.target.closest?.('[data-zone]')?.getAttribute('data-zone')};svg.setPointerCapture(event.pointerId);});
  svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){const rect=svg.getBoundingClientRect();viewport={...drag.original,x:drag.original.x-dx*drag.original.width/rect.width,y:drag.original.y-dy*drag.original.height/rect.height};setView();}});
  svg.addEventListener('pointerup',()=>{if(drag){const clicked=drag.code,moved=drag.moved;suppressClick=true;drag=null;if(clicked&&!moved)choose(clicked);setTimeout(()=>{suppressClick=false;},0);}});svg.addEventListener('pointercancel',()=>{drag=null;suppressClick=false;});
  $('territorial-map').replaceChildren(svg);setView();
}
function renderLegend(){
  const legend=$('map-legend');legend.replaceChildren();
  const item=(label,color,hatch=false)=>{const node=el('span','map-legend-item'),swatch=el('i',hatch?'map-hatch':'');if(color)swatch.style.background=color;node.append(swatch,document.createTextNode(label));return node;};
  if($('map-party').value||candidate())for(const [label,value]of [['0–9,999%',0],['10–19,999%',10],['20–29,999%',20],['30–39,999%',30],['40% o más',40]])legend.append(item(label,intensity(value)));
  else for(const name of [...new Set(rows.filter(row=>row.available).map(row=>row.party.name))])legend.append(item(humanize(name),partyColor(name)));
  legend.append(item('Sin datos compatibles',null,true));
}
function renderDetails(){
  const row=rows.find(row=>row.zone.code===selected),panel=$('map-detail');panel.replaceChildren();if(!row)return;
  panel.append(el('span','eyebrow',row.zone.level==='district'?'DISTRITO · '+row.zone.provinceName:row.zone.level==='province'?'PROVINCIA':'DEPARTAMENTO'),el('h2','',row.zone.name));
  if(!row.available){panel.append(el('span','map-status muted',row.eligible?'Desglose no disponible':'Fuera del ámbito de la candidatura'),el('p','map-description',row.eligible?'La fuente consultada no permite atribuir a esta zona un porcentaje del cargo seleccionado. El resultado de su provincia o departamento no se copia a este polígono.':'Esta candidatura no postula a la alcaldía de esta provincia. El resultado de otra persona del mismo partido no se interpreta como su apoyo.'));
    const aggregateCode=election()==='regional'?'220000':row.zone.provinceCode,parent=snapshot.geography.features.find(f=>f.properties.code===aggregateCode),report=parent&&compatibleReport(snapshot,election(),parent.properties);
    if(report)panel.append(button(row.eligible?'Ver reporte '+(election()==='regional'?'del departamento':'de la provincia'):'Ver listas de esta provincia',()=>{if(!row.eligible){$('map-candidate').value='';$('map-party').value='';}$('map-level').value=election()==='regional'?'department':'province';selected=aggregateCode;resetView();render();}));
    panel.append(link('Consultar resultados oficiales ↗','https://resultadoelectoral.onpe.gob.pe/'));return;
  }
  const report=row.report,top=row.party;
  panel.append(el('span','map-status','Reporte de listas · No proclamación'));
  const header=el('div','map-leader');const image=photo(top.candidate);if(image)header.append(image);const identity=el('div');identity.append(el('strong','',top.candidate?humanize(top.candidate.name):humanize(top.name)),el('p','',humanize(top.name)));header.append(identity);panel.append(header);
  const value=el('div','map-value');value.append(el('strong','',pct(top.percent)),el('span','','de votos válidos de su lista'));panel.append(value);
  const metrics=el('dl','map-report-metrics');for(const [label,value]of [['Votos de la lista',number(top.votes,0)],['Votos válidos del reporte',number(report.validVotes,0)],['Avance de actas',pct(report.progress)],['Fecha indicada en la fuente',date(report.reportedAt)]]){const group=el('div');group.append(el('dt','',label),el('dd','',value));metrics.append(group);}panel.append(metrics);
  if(!report.totalsCompatible)panel.append(el('p','map-data-note','El resumen de actas de la fuente tiene un total distinto al de la lista publicada. Se muestran sus porcentajes y votos, pero no se reutiliza la fecha ni el avance de ese resumen.'));
  const ranking=el('div','map-local-ranking');ranking.append(el('h3','','Listas del mismo reporte'));
  report.parties.forEach(party=>{const line=el('div','map-ranking-line');line.append(el('span','',humanize(party.name)),el('strong','',pct(party.percent)));ranking.append(line);});panel.append(ranking);
  panel.append(link('Ver fuente del resultado ↗',report.sourceUrl));if(top.candidate)panel.append(link('Ver hoja de vida en el JNE ↗',top.candidate.sourceUrl));
  panel.append(el('p','map-source-date','Consulta: '+snapshot.consultedAt+' · '+report.sourceName));
}
function exportMap(){const url=URL.createObjectURL(new Blob([territorialCSV(rows,election())],{type:'text/csv;charset=utf-8'}));const anchor=el('a');anchor.href=url;anchor.download='tacna-resultados-territoriales.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function init(){
  if(!ready)ready=Promise.all([fetch('./territorial.json').then(r=>{if(!r.ok)throw new Error('No se pudo cargar la información territorial.');return r.json();}),fetch('./candidates.json').then(r=>{if(!r.ok)throw new Error('No se pudo cargar el catálogo.');return r.json();})]).then(([data,catalog])=>{snapshot=data;candidates=catalog.candidates;}).catch(error=>{ready=null;throw error;});
  try{await ready;
    if(!bound){bound=true;const provinces=snapshot.geography.features.filter(f=>f.properties.level==='province');$('map-province').replaceChildren(new Option('Todas las provincias',''),...provinces.map(f=>new Option(f.properties.name,f.properties.code)));
      $('map-election').addEventListener('change',()=>{$('map-candidate').value='';$('map-party').value='';$('map-level').value=election()==='regional'?'department':'province';options();selected=election()==='regional'?'220000':'220100';resetView();render();});
      for(const id of ['map-level','map-province'])$(id).addEventListener('change',()=>{resetView();render();});
      $('map-party').addEventListener('change',()=>{$('map-candidate').value='';render();});
      $('map-candidate').addEventListener('change',()=>{$('map-party').value='';const person=candidate();if(person?.role==='municipal'){$('map-province').value=person.scopeCode;if(level()==='department')$('map-level').value='province';selected=person.scopeCode;}render();});
      $('map-zone').addEventListener('change',()=>choose($('map-zone').value));$('map-zoom-in').addEventListener('click',()=>zoom(1.35));$('map-zoom-out').addEventListener('click',()=>zoom(1/1.35));
      $('map-fit').addEventListener('click',()=>{resetView();setView();});$('map-reset').addEventListener('click',()=>{$('map-election').value='municipal';$('map-level').value='province';$('map-party').value='';$('map-candidate').value='';$('map-province').value='';selected='220100';resetView();options();render();});$('map-export').addEventListener('click',exportMap);
    }
    candidates=candidates.map(c=>({...c,scopeCode:c.role==='regional'&&partyKey(c.scope)===partyKey('Departamento de Tacna')?'220000':snapshot.geography.features.find(f=>f.properties.level==='province'&&partyKey(c.scope)===partyKey('Provincia de '+f.properties.name))?.properties.code}));
    options();$('map-loading').textContent='Geometría referencial · 4 provincias / 28 distritos · Consulta: '+snapshot.consultedAt;$('map-content').hidden=false;render();
  }catch(error){$('map-loading').replaceChildren(document.createTextNode(error.message+' '),button('Volver a intentar',()=>init()));throw error;}
}
