import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createStaticServer} from '../scripts/serve-static.mjs';
import {createDashboardServer} from '../scripts/serve.mjs';
import {createCandidateClient} from '../public/candidate-data.js';

const candidates=JSON.parse(await readFile(new URL('../public/candidates.json',import.meta.url),'utf8')).candidates;
const start=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>server.close(resolve));
const fetcher=base=>(path,options)=>fetch(new URL(path,base+'/'),options);

test('Render Static Site: perfiles, filtros, gráficas y exportaciones funcionan sin API',async()=>{
  const server=createStaticServer({root:resolve('public')}),base=await start(server),calls=[];
  const client=createCandidateClient({fetcher:(path,options)=>{calls.push(path);return fetcher(base)(path,options);}});
  try {
    const meta=await client.meta();assert.equal(meta.mode,'snapshot');assert.equal(meta.total,21);assert.equal(meta.supportsImport,false);
    for(const candidate of candidates) {
      const detail=await client.detail(candidate.id);assert.equal(detail.name,candidate.name);assert.ok(detail.description);assert.ok(detail.analysis);
      assert.equal((await fetch(base+detail.photo.url)).status,200);
    }
    assert.equal((await client.list(new URLSearchParams({role:'municipal',limit:'1'}))).candidates.length,1);
    const analytics=await client.analytics(new URLSearchParams({role:'municipal',limit:'1'}));assert.equal(analytics.total,7);assert.equal(analytics.withPercent,4);
    assert.equal((await client.list(new URLSearchParams({role:'municipal',percentage:'missing'}))).total,3);
    assert.equal((await client.list(new URLSearchParams({q:'chinchazo'}))).total,1);
    const csv=await client.csv(new URLSearchParams({role:'municipal',limit:'1'}));assert.equal(csv.split('\r\n').length,8);assert.match(csv,/NIEL BRHAM ZAVALA MEZA/);
    assert.equal((await client.backup()).candidates.length,21);
    await assert.rejects(()=>client.import({candidates:[candidates[0]]}),/consulta/);
    assert.ok(calls.every(path=>!path.startsWith('/api/')),'El sitio estático no intenta usar endpoints inexistentes');
  }finally{await close(server);}
});

test('Catálogo estático y SQLite producen el mismo resultado para todos los filtros',async()=>{
  const staticServer=createStaticServer({root:resolve('public')}),apiServer=await createDashboardServer({root:resolve('public'),dbPath:':memory:'});
  const [staticURL,apiURL]=await Promise.all([start(staticServer),start(apiServer)]);
  const snapshot=createCandidateClient({fetcher:fetcher(staticURL)}),api=createCandidateClient({fetcher:fetcher(apiURL)});
  try {
    assert.equal((await api.meta()).mode,'server');assert.equal((await api.meta()).supportsImport,true);
    for(const params of [{},{role:'municipal'},{role:'regional'},{percentage:'reported'},{percentage:'missing'},{q:'medico'},{q:'%'},{party:'ALIANZA PARA EL PROGRESO'},{sort:'votes',page:'2',limit:'8'},{q:'no-coincide'}]) {
      const query=new URLSearchParams(params),a=await snapshot.list(query),b=await api.list(query);
      assert.equal(a.total,b.total);assert.equal(a.page,b.page);assert.deepEqual(a.candidates.map(c=>c.id),b.candidates.map(c=>c.id));
      assert.deepEqual(await snapshot.analytics(query),await api.analytics(query));
      const csvA=await snapshot.csv(query),csvB=await api.csv(query);
      assert.equal(csvA.replace(/^\uFEFF/,''),csvB.replace(/^\uFEFF/,''));
    }
    const result=await api.import({candidates:[candidates[0]]});assert.equal(result.imported,1);
    assert.equal((await api.backup()).candidates.length,21);
  }finally{await Promise.all([close(staticServer),close(apiServer)]);}
});

test('Despliegue antiguo con 404 o rewrite HTML de la API utiliza el catálogo',async()=>{
  const server=createStaticServer({root:resolve('public')}),base=await start(server);
  try {
    for(const rewrite of [false,true]) {
      const client=createCandidateClient({fetcher:(path,options)=>path==='./runtime.json'?Promise.resolve(new Response('Not Found',{status:404})):path==='/api/candidates/meta'?Promise.resolve(rewrite?new Response('<html>Inicio</html>',{headers:{'Content-Type':'text/html'}}):new Response('Not Found',{status:404})):fetcher(base)(path,options)});
      assert.equal((await client.meta()).total,21);assert.equal(client.mode,'snapshot');assert.equal((await client.detail(candidates[0].id)).name,candidates[0].name);
    }
  }finally{await close(server);}
});

test('Una carga interrumpida del catálogo se puede reintentar',async()=>{
  const server=createStaticServer({root:resolve('public')}),base=await start(server);let failed=false;
  const client=createCandidateClient({fetcher:(path,options)=>{if(path==='./candidates.json'&&!failed){failed=true;return Promise.resolve(new Response('Temporary failure',{status:503}));}return fetcher(base)(path,options);}});
  try{await assert.rejects(()=>client.meta(),/503/);assert.equal((await client.meta()).total,21);}finally{await close(server);}
});

test('Inicio de producción usa PORT, 0.0.0.0 y una ruta SQLite externa al proyecto',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'electoral-deploy-'));
  const child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:resolve('.'),env:{...process.env,HOST:'',RENDER:'true',PORT:'0',DATABASE_PATH:join(directory,'candidates.sqlite')}});
  try {
    const output=await new Promise((resolve,reject)=>{
      let stdout='',stderr='';const timer=setTimeout(()=>reject(new Error('El servidor no inició: '+stderr)),15000);
      child.stdout.on('data',data=>{stdout+=data;if(/localhost:\d+/.test(stdout)){clearTimeout(timer);resolve(stdout);}});
      child.stderr.on('data',data=>{stderr+=data;});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('El servidor terminó: '+stderr));});
    });
    assert.match(output,/Host: 0\.0\.0\.0/);const port=Number(output.match(/localhost:(\d+)/)[1]);assert.ok(port>0);
    const base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(base+'/api/health')).status,200);
    assert.equal((await fetch(base+'/api/health',{method:'HEAD'})).status,200);
    assert.equal((await (await fetch(base+'/runtime.json')).json()).mode,'server');
    assert.equal((await (await fetch(base+'/api/candidates/meta')).json()).total,21);
    assert.ok((await readFile(join(directory,'candidates.sqlite'))).length>0);
  }finally{
    if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
    const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('electoral-deploy-'));await rm(target,{recursive:true,force:true});
  }
});
