import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher,setGlobalDispatcher,ProxyAgent } from 'undici';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { gzipSync } from 'node:zlib';
import { once } from 'node:events';
import { mkdtemp,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseStoreProxy } from '../src/core/store-proxy.ts';
import { StoreNetwork } from '../src/management/store-network.ts';
import { createStoreTransport } from '../src/runtime/store-transport.ts';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import { Admin } from '../src/management/admin.ts';
import { managementConfig } from '../src/management/config.ts';
import { hashPassword } from '../src/management/password.ts';
import { publicThemeState } from '../src/themes/store.ts';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'leobridge-store-proxy-')),store=new FileThemeStore(root);
  await store.command({type:'session',id:'setup',session:{csrf:'setup',expires:Date.now()+60_000}});
  await store.command({type:'password',sessionId:'setup',expectedVersion:0,credential:await hashPassword('Synthetic-proxy-2026!',1)});
  await store.command({type:'session',id:'s',session:{csrf:'csrf',expires:Date.now()+60_000,credentialVersion:1}});
  return {root,store,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('store proxy validates URLs without reflecting credentials',()=>{
  for(const url of ['socks5://localhost:7897','file:///tmp/x','http://localhost/path','http://localhost?x=1','http://localhost#secret','bad-secret','http://%zz:secret@localhost']){
    assert.throws(()=>parseStoreProxy(true,url),error=>error instanceof Error&&!error.message.includes('secret'));
  }
  assert.throws(()=>parseStoreProxy('true','http://localhost'));
  assert.throws(()=>parseStoreProxy(true,''));
  assert.deepEqual(parseStoreProxy(false,''),{enabled:false,url:''});
  assert.equal(parseStoreProxy(true,'https://proxy.example:8443').url,'https://proxy.example:8443/');
});
test('proxy persistence, redaction, conflicts and revoked sessions preserve existing settings',async()=>{
  const f=await fixture();const transport=createStoreTransport();
  try{
    const network=new StoreNetwork(f.store,transport.run);
    assert.equal((await network.status()).enabled,false);
    await network.save({version:0,enabled:true,url:'http://alice:secret@proxy.example:8080'},'s');
    assert.equal((await network.status()).url,'http://proxy.example:8080');
    assert.equal((await network.status()).hasCredentials,true);
    assert.ok(!JSON.stringify(await network.status()).includes('secret'));
    assert.ok(!JSON.stringify(publicThemeState(await f.store.state())).includes('proxy.example'));
    const restarted=new StoreNetwork(new FileThemeStore(f.root),transport.run);
    assert.equal((await restarted.status()).url,'http://proxy.example:8080');
    await restarted.save({version:1,enabled:false,url:''},'s');
    assert.equal((await restarted.status()).enabled,false);
    await restarted.save({version:2,enabled:true,url:''},'s');
    assert.equal((await f.store.state()).storeProxy!.url,'http://alice:secret@proxy.example:8080/');
    await assert.rejects(network.save({version:2,enabled:false,url:''},'s'),/已变更/);
    await f.store.command({type:'logout',id:'s'});
    await assert.rejects(network.save({version:3,enabled:false,url:''},'s'),/重新登录/);
    assert.equal((await network.status()).enabled,true);
    assert.equal((await stat(join(f.root,'state.json'))).mode&0o777,0o600);
    const unsupported=new StoreNetwork(f.store);
    await assert.rejects(unsupported.run(async()=>true),/不支持/);
  }finally{await transport.destroy();await f.cleanup();}
});
test('store proxy API enforces login, password, Origin and CSRF; catalog uses scoped transport',async()=>{
  const f=await fixture();
  try{
    const requests:string[]=[],settings:boolean[]=[];
    const network=new StoreNetwork(f.store,async(setting,run)=>{settings.push(setting.enabled);return run(async input=>{
      const url=String(input);requests.push(url);
      if(url==='https://github.com/example/theme')return new Response('<span id="repo-stars-counter-star" title="42">42</span>');
      return Response.json(url.includes('/commits/')?{sha:'a'.repeat(40)}:{schema:1,themes:[{id:'example',short:'example',url:'https://github.com/example/theme',branch:'build'}]});
    })});
    const config=managementConfig({});const admin=new Admin(config,f.store,async()=>new Response('ui'),undefined,network);
    const send=(path:string,body?:unknown,headers:Record<string,string>={})=>admin.handle(new Request(config.adminOrigin+'/admin/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:config.adminOrigin,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
    assert.equal((await send('store-proxy')).status,401);
    const login=await send('login',{username:'admin',password:'Synthetic-proxy-2026!'}),cookie=login.headers.get('set-cookie')!.split(';')[0]!,csrf=(await login.json()).csrf;
    const body={version:0,enabled:true,url:'http://localhost:7897'};
    assert.equal((await send('store-proxy',body,{Cookie:cookie})).status,403);
    assert.equal((await send('store-proxy',body,{Cookie:cookie,'X-CSRF-Token':csrf,Origin:'https://bad.example'})).status,403);
    const saved=await send('store-proxy',body,{Cookie:cookie,'X-CSRF-Token':csrf});assert.equal(saved.status,200);
    for(const ecosystem of ['cfsm','komari']){
      const response=await send(`catalog?ecosystem=${ecosystem}&refresh=1`,undefined,{Cookie:cookie});
      assert.equal(response.status,200);assert.equal((await response.json()).entries[0].stars,42);
    }
    assert.deepEqual(settings,[true,true]);assert.equal(requests.length,5);
    assert.ok(requests.some(url=>url.includes('CFSM-Theme-Store')));assert.ok(requests.some(url=>url.includes('theme-market')));
    assert.equal((await send('store-proxy',undefined,{Cookie:cookie})).headers.get('cache-control'),'no-store');
  }finally{await f.cleanup()}
});
test('real Node CONNECT transport authenticates only to proxy, switches to direct and never falls back',async()=>{
  let hits=0;const proxyAuth:string[]=[],originAuth:string[]=[];
  const target=createServer((req,res)=>{hits++;originAuth.push(String(req.headers['proxy-authorization']||''));res.writeHead(200,{'Content-Type':'text/plain','Content-Encoding':'gzip'});res.end(gzipSync('synthetic package'));});
  const proxy=createServer();const sockets=new Set<import('node:net').Socket>();
  proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  proxy.on('connect',(req,client,head)=>{
    proxyAuth.push(String(req.headers['proxy-authorization']||''));
    const [host,port]=req.url!.split(':');const remote=connect(Number(port),host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);client.pipe(remote);remote.pipe(client);});
    remote.on('error',()=>client.destroy());client.on('close',()=>remote.destroy());
  });
  target.listen(0,'127.0.0.1');proxy.listen(0,'127.0.0.1');await Promise.all([once(target,'listening'),once(proxy,'listening')]);
  const url=`http://127.0.0.1:${(target.address() as import('node:net').AddressInfo).port}/package`,port=(proxy.address() as import('node:net').AddressInfo).port;
  const transport=createStoreTransport();
  try{
    const request=async(fetcher:typeof fetch)=>{const response=await fetcher(url);assert.equal(response.headers.get('content-type'),'text/plain');assert.equal(response.headers.get('content-encoding'),'gzip');return response.text();};
    assert.equal(await transport.run({enabled:true,url:`http://user:secret@127.0.0.1:${port}`},request),'synthetic package');
    assert.deepEqual(proxyAuth,['Basic '+Buffer.from('user:secret').toString('base64')]);assert.deepEqual(originAuth,['']);
    const previousDispatcher=getGlobalDispatcher(),globalProxy=new ProxyAgent(`http://127.0.0.1:${port}`);
    setGlobalDispatcher(globalProxy);
    try{assert.equal(await transport.run({enabled:false,url:`http://127.0.0.1:${port}`},request),'synthetic package');}
    finally{setGlobalDispatcher(previousDispatcher);await globalProxy.destroy();}
    assert.equal(proxyAuth.length,1);assert.equal(hits,2);
    for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));
    await assert.rejects(transport.run({enabled:true,url:`http://127.0.0.1:${port}`},request));assert.equal(hits,2);
  }finally{await transport.destroy();for(const socket of sockets)socket.destroy();proxy.close();target.closeAllConnections();await new Promise<void>(resolve=>target.close(()=>resolve()));}
});
