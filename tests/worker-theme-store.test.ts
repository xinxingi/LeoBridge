import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerThemeStore,type R2Binding,type CoordinatorBinding } from '../src/runtime/worker-theme-store.ts';
import { applyThemeCommand,emptyThemeState,commitInstallation,type Installation,type ThemeCommand } from '../src/themes/store.ts';

test('Worker creates a new Durable Object stub for each request instead of reusing request-scoped I/O',async()=>{
  let requestContext=1,created=0,state=emptyThemeState();
  const binding:CoordinatorBinding={idFromName:()=>0,get:()=>{created++;const context=requestContext;return {fetch:async request=>{assert.equal(context,requestContext,'cross-request I/O handle');if(request.method==='POST')state=applyThemeCommand(state,await request.json() as ThemeCommand);return Response.json(state);}};}};
  const store=new WorkerThemeStore({} as R2Binding,binding);
  await store.state();requestContext=2;
  await store.command({type:'session',id:'session-hash',session:{csrf:'csrf',expires:Date.now()+10000}});requestContext=3;
  assert.equal((await store.state()).sessions['session-hash'].csrf,'csrf');assert.equal(created,3);
});

test('Worker stores a complete immutable package once and range-reads only the requested file bytes',async()=>{
  let state=emptyThemeState();const objects=new Map<string,Uint8Array>();const ranges:{offset:number;length:number}[]=[];
  const bucket:R2Binding={put:async(key,value)=>{if(objects.has(key))return null;objects.set(key,value);return {};},get:async(key,options)=>{const bytes=objects.get(key);if(!bytes)return null;if(options?.range)ranges.push(options.range);const slice=options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes;return {arrayBuffer:async()=>slice.buffer as ArrayBuffer};}};
  const binding:CoordinatorBinding={idFromName:()=>0,get:()=>({fetch:async request=>{if(request.method==='POST')state=applyThemeCommand(state,await request.json() as ThemeCommand);return Response.json(state);}})};
  const store=new WorkerThemeStore(bucket,binding),id='a'.repeat(32);
  const files=[{path:'index.html',bytes:new TextEncoder().encode('<html>one</html>'),contentType:'text/html'},{path:'assets/app.js',bytes:new TextEncoder().encode('console.log(2)'),contentType:'text/javascript'}];
  const item:Installation={id,title:'Synthetic',ecosystem:'cfsm',source:'synthetic',pinnedVersion:'test',protocolProfile:'cfsm-609cc0b',license:{spdx:'MIT',text:'test',source:'test',sha256:'test'},entry:'index.html',installedAt:'test',compatibility:'unverified',bundled:false,files:Object.fromEntries(files.map(f=>[f.path,{size:f.bytes.length,contentType:f.contentType}]))};
  await commitInstallation(store,item,files);assert.equal(objects.size,1);
  assert.deepEqual((await store.asset(id,'assets/app.js'))?.bytes,files[1].bytes);
  assert.deepEqual(ranges,[{offset:files[0].bytes.length,length:files[1].bytes.length}]);
  await assert.rejects(store.putAssets(id,[{...files[0],bytes:new Uint8Array([42])}]),/Immutable upload conflict/);
  assert.equal(await store.asset(id,'../secret'),null);
});
