import { analyze, normalize, describeCandidate, electoralFor, businessAnalytics, candidateCSV } from './candidate-model.js';

// Render Static Sites serve files but do not run the SQLite API. Both deployments
// use the same published records and calculations, with no invented API routes.
export function createCandidateClient({ fetcher = globalThis.fetch.bind(globalThis), probeTimeout = 6000 } = {}) {
  let mode='loading', metadata, snapshot, records, initialized;
  const timeout=milliseconds=>AbortSignal.timeout(milliseconds);
  async function json(path,options={}) {
    const response=await fetcher(path,{...options,signal:options.signal || timeout(15000)});
    if(!response.ok) {
      const body=await response.json().catch(()=>null);
      throw new Error(body?.error || `No se pudo cargar la información (HTTP ${response.status}).`);
    }
    if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('La respuesta no contiene datos JSON.');
    return response.json();
  }
  async function ready() {
    if(initialized) return initialized;
    initialized=(async()=>{
      try {
        let runtime;
        try {runtime=await json('./runtime.json',{signal:timeout(probeTimeout)});}catch{}
        if(runtime?.mode==='snapshot') throw new Error('Catálogo estático publicado');
        const meta=await json('/api/candidates/meta',{signal:timeout(probeTimeout)});
        if(!Number.isInteger(meta?.total) || !Array.isArray(meta.parties) || !meta.source) throw new Error('API de candidatos incompatible.');
        metadata={...meta,mode:'server',supportsImport:true};mode='server';return;
      } catch {
        const [catalog,reports]=await Promise.all([json('./candidates.json'),json('./data.json')]);
        if(!Array.isArray(catalog.candidates) || !catalog.candidates.length || !Array.isArray(reports.sources)) throw new Error('El catálogo publicado no está disponible.');
        snapshot=catalog;
        records=catalog.candidates.map(candidate=>({...candidate,description:candidate.description || describeCandidate(candidate),electoral:electoralFor(candidate,reports),analysis:analyze(candidate)}));
        metadata={mode:'snapshot',supportsImport:false,canWrite:false,storage:'Catálogo publicado',total:records.length,municipal:records.filter(c=>c.role==='municipal').length,regional:records.filter(c=>c.role==='regional').length,reviewed:records.filter(c=>c.analysis.coverage===100).length,parties:[...new Set(records.map(c=>c.party))].sort(),latestConsultation:records.map(c=>c.source.consultedAt).sort().at(-1),source:{consultedAt:catalog.consultedAt,scope:catalog.scope,unavailableLists:catalog.unavailableLists || []}};
        mode='snapshot';
      }
    })().catch(error=>{initialized=null;mode='loading';throw error;});
    return initialized;
  }
  function filtered(params) {
    const query=normalize(params.get('q') || '').trim();
    return records.filter(c=>(!params.get('role') || c.role===params.get('role')) && (!params.get('party') || c.party===params.get('party')) && (!query || normalize(c.name+' '+c.party+' '+c.education.map(e=>e.degree).join(' ')).includes(query)) && (params.get('percentage')!=='reported' || c.electoral!==null) && (params.get('percentage')!=='missing' || c.electoral===null));
  }
  function checkSignal(options) { if(options?.signal?.aborted) throw new DOMException('Consulta cancelada','AbortError'); }
  return {
    get mode(){return mode;},
    async meta(){await ready();if(mode==='server') metadata={...await json('/api/candidates/meta'),mode:'server',supportsImport:true};return metadata;},
    async list(params,options={}) {
      await ready();checkSignal(options);
      if(mode==='server') return json('/api/candidates?'+params,options);
      const sorted=filtered(params).sort((a,b)=>{
        if(params.get('sort')==='votes') return a.role.localeCompare(b.role) || Number(a.electoral===null)-Number(b.electoral===null) || (b.electoral?.percent ?? 0)-(a.electoral?.percent ?? 0) || a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id);
        if(params.get('sort')==='recent') return b.source.consultedAt.localeCompare(a.source.consultedAt) || a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id);
        return a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id);
      });
      const total=sorted.length,limit=Math.min(50,Math.max(1,parseInt(params.get('limit'),10)||12)),page=Math.min(Math.max(1,Math.ceil(total/limit)),Math.max(1,parseInt(params.get('page'),10)||1));
      return {total,page,limit,candidates:sorted.slice((page-1)*limit,page*limit)};
    },
    async analytics(params,options={}) {await ready();checkSignal(options);return mode==='server'?json('/api/candidates/analytics?'+params,options):businessAnalytics(filtered(params));},
    async detail(id) {
      await ready();if(mode==='server')return json('/api/candidates/'+encodeURIComponent(id));
      const candidate=records.find(c=>c.id===id);if(!candidate)throw new Error('Candidato no encontrado.');return candidate;
    },
    async csv(params) {
      await ready();if(mode==='snapshot')return candidateCSV(filtered(params));
      const response=await fetcher('/api/candidates/export?'+params,{signal:timeout(15000)});
      if(!response.ok || !response.headers.get('content-type')?.includes('text/csv'))throw new Error('No se pudo descargar el CSV.');return response.text();
    },
    async backup() {await ready();return mode==='server'?json('/api/candidates/backup'):{schemaVersion:1,exportedAt:new Date().toISOString(),candidates:snapshot.candidates};},
    async import(payload,token='') {
      await ready();if(mode!=='server')throw new Error('El catálogo publicado es de consulta. Para actualizarlo utiliza el servidor con SQLite.');
      return json('/api/candidates/import',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});
    }
  };
}
