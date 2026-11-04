import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeService } from '../src/protocols/native/service.ts';
import { nativeRealtime } from '../src/protocols/native/realtime.ts';
import { Upstream } from '../src/upstream/client.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
import { fetchCatalog, CATALOG_SOURCES } from '../src/themes/catalog.ts';
import { readConfig } from './helpers/config.ts';
import type { Socket } from '../src/core/socket.ts';
import { installDependencies } from '../src/runtime/native-build.ts';
const config=()=>readConfig({MMWX_BASE_URL:'https://source.test',MMWX_PROBE_TOKEN:'secret',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{cpu_model:'A'}},{id:'b',match:{cpu_model:'B'}}])});
const raw=()=>({enabled:true,show_name:true,title:'Native',appearance:{theme:'pixel',color_mode:'dark'},license_badge:{name:'original'},history_days:7,private_token:'must-not-leak',servers:[{cpu_model:'A',name:'A',online:true,cpu_pct:0,traffic_used:456,traffic_used_scope:'configured_period',ping:[{key:'x',label:'X',current_ms:-1,loss_pct:-1,buckets:[{ms:-1,loss:-1}],host:'private-target'}],secret:'hidden'},{cpu_model:'B',name:'B',online:false,mem_used:0}]});
const request=(path:string)=>new Request('https://view.test'+path);
test('native catalog is independent and pinned to audited source; unsupported revisions fail',async()=>{
  const value=await fetchCatalog('native',async()=>{throw new Error('must not resolve main');},{latest:true});
  assert.equal(value.entries[0].repositoryUrl,'https://github.com/mmwx-group/mmwx-probe');assert.equal(value.entries[0].compatibility,'unverified');
  assert.equal(value.catalogRevision,CATALOG_SOURCES.native.revision);
  await assert.rejects(fetchCatalog('native',undefined,{revision:'f'.repeat(40)}),{code:'NATIVE_REVISION'});
});
test('native snapshot retains source units, zero/missing, appearance and source badge, but projects public fields',()=>{
  const service=new NativeService(config()),source=raw(),result=service.snapshot(normalizeSnapshot(source));
  const serialized=JSON.stringify(result);assert.doesNotMatch(serialized,/must-not-leak|private-target|hidden/);
  const servers=result.servers as any[];
  assert.equal(servers[0].cpu_pct,0);assert.equal(servers[0].traffic_used,456);assert.equal(servers[0].traffic_used_scope,'configured_period');assert.equal(servers[1].cpu_pct,undefined);assert.equal(servers[1].online,false);
  assert.deepEqual(result.appearance,source.appearance);assert.deepEqual(result.license_badge,source.license_badge);assert.equal(servers[0].ping[0].buckets[0].ms,-1);
});
test('native display slots keep explicit identities across upstream reorder; ambiguous identities fail',()=>{
  const service=new NativeService(config()),source=raw();source.servers.reverse();
  assert.deepEqual((service.snapshot(normalizeSnapshot(source)).servers as any[]).map(row=>row.cpu_model),['A','B']);
  source.servers[0].cpu_model='A';assert.throws(()=>service.snapshot(normalizeSnapshot(source)),{code:'IDENTITY_AMBIGUOUS'});
});
test('native hidden names and disabled snapshots never expose names or stale nodes',()=>{
  const service=new NativeService(config()),source={...raw(),show_name:false,forward:[{name:'Hidden chain'}]};
  const result=service.snapshot(normalizeSnapshot(source));assert.equal(result.forward,undefined);assert.ok((result.servers as any[]).every(row=>row.name===undefined));
  assert.deepEqual(service.snapshot(normalizeSnapshot({...source,enabled:false})),{enabled:false});
});
function historyFixture(change=false){
  const source=raw();source.servers.reverse();let snapshots=0;const calls:URL[]=[];
  const upstream=new Upstream(config(),async(input,init)=>{
    const url=new URL(String(input));calls.push(url);assert.equal((init?.headers as Record<string,string>)['X-MMwx-Probe-Token'],'secret');
    if(url.pathname.endsWith('probe-servers')){snapshots++;if(change&&snapshots>1)source.servers.reverse();return Response.json(source);}
    return Response.json({success:true,bucket_sec:7200,buckets:84,generated_at:1_800_000_000,series:{cpu_pct:[{t:1_800_000_000,value:0}],cumulative_up:[{t:1_800_000_000,value:123}],unknown_secret:[{t:1_800_000_000,value:42}]},private_token:'hidden'});
  });return {service:new NativeService(config(),upstream),calls};
}
test('native history remaps view slot to fresh source index and keeps sparse series unmodified',async()=>{
  const {service,calls}=historyFixture();const response=await service.handle(request('/api/series?server=0&metric=system&range=7d&token=visitor'));
  const result=await response!.json();const call=calls.find(url=>url.pathname.endsWith('probe-series'))!;
  assert.equal(call.searchParams.get('server'),'1');assert.equal(call.searchParams.get('token'),null);
  assert.equal(result.buckets,84);assert.equal(result.series.cpu_pct.length,1);assert.equal(result.series.cpu_pct[0].value,0);assert.equal(result.series.cumulative_up[0].value,123);assert.equal(result.series.unknown_secret,undefined);
});
test('native history rejects reorder during request and invalid range, index or method',async()=>{
  await assert.rejects(historyFixture(true).service.handle(request('/api/series?server=0&metric=system&range=7d')),{code:'IDENTITY_CHANGED'});
  const service=historyFixture().service;
  for(const query of ['server=-1','server=2','server=0&range=8d','server=0&metric=secret'])await assert.rejects(service.handle(request('/api/series?'+query)));
  await assert.rejects(service.handle(new Request('https://view.test/api/probe',{method:'POST'})),{status:405});
  assert.equal(await service.handle(request('/api/login/passkey/begin')),null);
});
test('native disabled HTTP source is an explicit disabled payload; transport failures stay failures',async()=>{
  const service=new NativeService(config(),new Upstream(config(),async()=>Response.json({enabled:false,servers:[{name:'stale'}]})));
  assert.deepEqual(await (await service.handle(request('/api/probe')))!.json(),{enabled:false});
  const failing=new NativeService(config(),new Upstream(config(),async()=>new Response('secret',{status:503})));
  await assert.rejects(failing.handle(request('/api/probe')),{code:'UPSTREAM_HTTP'});
});
class FakeSocket implements Socket{
  sent:string[]=[];closed=false;message=(data:string)=>{};closeHandler=()=>{};errorHandler=()=>{};
  send(data:string){this.sent.push(data);}close(){this.closed=true;}onMessage(fn:(data:string)=>void){this.message=fn;}onClose(fn:()=>void){this.closeHandler=fn;}onError(fn:()=>void){this.errorHandler=fn;}
}
test('native websocket requires no subscription and sends only native snapshots, cleaning both ends',async()=>{
  const client=new FakeSocket(),source=new FakeSocket(),service=new NativeService(config());
  const session=nativeRealtime(service,client,async()=>source);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(client.sent.length,0);source.message(JSON.stringify(raw()));assert.equal(JSON.parse(client.sent[0]).enabled,true);assert.equal(JSON.parse(client.sent[0]).type,undefined);
  session.close();assert.equal(source.closed,true);assert.equal(client.closed,true);source.message(JSON.stringify(raw()));assert.equal(client.sent.length,1);
});
test('late native websocket connection is cancelled and invalid frames do not become fake data',async()=>{
  const client=new FakeSocket(),source=new FakeSocket();let resolve!:(socket:Socket)=>void;
  const session=nativeRealtime(new NativeService(config()),client,()=>new Promise(r=>resolve=r));session.close();resolve(source);await new Promise(r=>setImmediate(r));assert.equal(source.closed,true);
  const c=new FakeSocket(),s=new FakeSocket();nativeRealtime(new NativeService(config()),c,async()=>s);await new Promise(r=>setImmediate(r));s.message('{bad');assert.equal(c.closed,true);assert.equal(s.closed,true);assert.equal(c.sent.length,0);
});
test('native dependency preparation refuses non-registry, unpinned and linked dependencies before invoking npm',async()=>{
  for(const value of [{resolved:'https://other.test/a.tgz',integrity:'sha512-YQ=='},{resolved:'https://registry.npmjs.org/a.tgz'}, {link:true}]){
    await assert.rejects(installDependencies('/unused',{lockfileVersion:3,packages:{'node_modules/a':value}},async()=>{throw new Error('unexpected fetch');}));
  }
});

test('native forward endpoint preserves the consumer chains envelope and refuses hidden names',async()=>{
  let requests=0;
  const source=raw();const upstream=new Upstream(config(),async(input)=>{
    if(String(input).includes('probe-forward')){requests++;return Response.json({success:true,chains:[{name:'Chain',groups:[{name:'Entry',role:'entry',servers:[{name:'A',healthy:true,token:'hidden'}]}],trend:[],secret:'hidden'}]});}
    return Response.json(source);
  });
  const service=new NativeService(config(),upstream),result=await (await service.handle(request('/api/forward')))!.json();
  assert.equal(result.chains[0].name,'Chain');assert.doesNotMatch(JSON.stringify(result),/hidden/);
  source.show_name=false;upstream.invalidate();assert.deepEqual(await (await service.handle(request('/api/forward')))!.json(),{chains:[]});assert.equal(requests,1);
});

test('native dependency installation uses injected downloads, verifies integrity and never runs lifecycle scripts',async t=>{
  const {mkdtemp,mkdir,writeFile,readFile,rm,stat}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');const {createHash}=await import('node:crypto');
  const root=await mkdtemp(join(tmpdir(),'leobridge-npm-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const packed=join(root,'packed');await mkdir(join(packed,'package'),{recursive:true});
  await writeFile(join(packed,'package/package.json'),JSON.stringify({name:'native-fixture',version:'1.0.0',scripts:{install:'node -e "require(\'fs\').writeFileSync(\'ran-script\',\'bad\')"'}}));
  await writeFile(join(packed,'package/index.js'),'module.exports=42;');
  execFileSync('tar',['-czf',join(root,'fixture.tgz'),'-C',packed,'package']);
  const bytes=await readFile(join(root,'fixture.tgz')),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  const fixture={name:'test-app',version:'1.0.0',dependencies:{'native-fixture':'1.0.0'}};
  const lock={name:'test-app',version:'1.0.0',lockfileVersion:3,packages:{'':fixture,'node_modules/native-fixture':{version:'1.0.0',resolved:'https://registry.npmjs.org/native-fixture/-/native-fixture-1.0.0.tgz',integrity,hasInstallScript:true}}};
  const installRoot=join(root,'app');await mkdir(installRoot);await writeFile(join(installRoot,'package.json'),JSON.stringify(fixture));
  const seen:string[]=[];
  await installDependencies(installRoot,structuredClone(lock),async(input)=>{seen.push(String(input));return new Response(new Uint8Array(bytes));});
  assert.deepEqual(seen,['https://registry.npmjs.org/native-fixture/-/native-fixture-1.0.0.tgz']);
  assert.equal(await readFile(join(installRoot,'node_modules/native-fixture/index.js'),'utf8'),'module.exports=42;');
  await assert.rejects(stat(join(installRoot,'node_modules/native-fixture/ran-script')),{code:'ENOENT'});
  const badRoot=join(root,'bad');await mkdir(badRoot);await writeFile(join(badRoot,'package.json'),JSON.stringify(fixture));
  await assert.rejects(installDependencies(badRoot,structuredClone(lock),async()=>new Response('corrupted tarball')));
});

test('native overrides are scoped to HTTP/WS presentation and preserve source appearance, badges and disabled state',async()=>{
  const input=raw(),upstream=new Upstream(config(),async()=>Response.json(input)),service=new NativeService(config(),upstream);
  for(const theme of ['pixel','flat','anime','premium'] as const){
    const presentation={theme:'mmwx-probe',settings:{},nativeTheme:theme};
    const response=await (await service.handle(request('/api/probe'),presentation))!.json();
    assert.deepEqual(response.appearance,{...input.appearance,theme});assert.deepEqual(response.license_badge,input.license_badge);
    assert.deepEqual((await (await service.handle(request('/api/probe')))!.json()).appearance,input.appearance);
    const client=new FakeSocket(),source=new FakeSocket(),session=nativeRealtime(service,client,async()=>source,presentation);
    await new Promise(r=>setImmediate(r));source.message(JSON.stringify(input));
    assert.deepEqual(JSON.parse(client.sent[0]).appearance,response.appearance);session.close();
    assert.deepEqual(service.snapshot(normalizeSnapshot({...input,enabled:false}),presentation),{enabled:false});
  }
  assert.deepEqual(service.snapshot(normalizeSnapshot(input),{theme:'native',settings:{},nativeTheme:'source'}).appearance,input.appearance);
  assert.deepEqual(input.appearance,{theme:'pixel',color_mode:'dark'});
});
