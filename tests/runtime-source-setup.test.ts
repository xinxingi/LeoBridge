import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import { commitInstallation, type Installation } from '../src/themes/store.ts';
const root=resolve(import.meta.dirname,'..');
async function listen(server:Server){await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));return (server.address() as {port:number}).port}

test('Node empty setup, API configuration, stable IDs, WS replacement and restart (synthetic only)',{timeout:40_000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'leobridge-runtime-setup-')),envFile=join(dir,'empty.env'),assets=join(dir,'assets'),stateDir=join(dir,'state');
  const children:ChildProcess[]=[],wss=new WebSocketServer({noServer:true});let closed=0;
  let snapshot={enabled:true,show_name:true,servers:[{name:'node-one',cpu_pct:1}]};
  const upstream=createServer((req,res)=>{
    if(req.headers['x-mmwx-probe-token']!=='synthetic-token'){res.writeHead(401);res.end('{}');return}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot));
  });
  upstream.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,ws=>{ws.on('close',()=>closed++);ws.send(JSON.stringify(snapshot))}));
  const upstreamPort=await listen(upstream),reservation=createServer(),port=await listen(reservation);await new Promise<void>(done=>reservation.close(()=>done()));
  const origin=`http://127.0.0.1:${port}`;
  t.after(async()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');for(const ws of wss.clients)ws.terminate();wss.close();upstream.closeAllConnections();await new Promise<void>(done=>upstream.close(()=>done()));await rm(dir,{recursive:true,force:true})});
  await mkdir(join(assets,'_management'),{recursive:true});await writeFile(envFile,'');await writeFile(join(assets,'index.json'),'[]');await writeFile(join(assets,'_management/index.html'),'Synthetic management');
  const store=new FileThemeStore(stateDir),id='e'.repeat(32),bytes=new TextEncoder().encode('Synthetic theme');
  const item:Installation={id,title:'Synthetic',ecosystem:'cfsm',source:'fixture',pinnedVersion:'fixture',protocolProfile:'cfsm-609cc0b',license:{spdx:'MIT',text:'fixture',source:'fixture',sha256:'0'.repeat(64)},entry:'index.html',installedAt:new Date().toISOString(),compatibility:'verified',bundled:false,files:{'index.html':{size:bytes.length,contentType:'text/html'}}};
  await commitInstallation(store,item,[{path:'index.html',bytes,contentType:'text/html'}],true);
  let logs='';
  async function launch(){
    const entry=process.env.BRIDGE_TEST_BUILT_NODE==='1'?['dist/node.js']:['--import','tsx','src/runtime/node.ts'];
    const child=spawn(process.execPath,entry,{cwd:root,env:{BRIDGE_ENV_FILE:envFile,BRIDGE_LISTEN_PORT:String(port),BRIDGE_ORIGIN:origin,BRIDGE_ASSETS_DIR:assets,BRIDGE_THEME_STORE:stateDir,NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe']});children.push(child);
    child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
    for(let i=0;i<100;i++){assert.equal(child.exitCode,null,logs);try{if((await fetch(origin+'/healthz')).ok)return child}catch{}await delay(25)}throw new Error('startup timeout');
  }
  async function stop(child:ChildProcess){const stopped=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGTERM');await stopped}
  let child=await launch(),cookie='',csrf='';
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch(origin+'/admin/api/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0]!;if(data.csrf)csrf=data.csrf;return data;
  };
  assert.match(await (await fetch(origin+'/')).text(),/尚未配置数据源/);
  assert.equal(await (await fetch(origin+'/admin/')).text(),'Synthetic management');
  await api('login',{username:'admin',password:'admin'});
  await api('password',{currentPassword:'admin',newPassword:'Setup-Password-2026!',confirmPassword:'Setup-Password-2026!'});
  await api('login',{username:'admin',password:'Setup-Password-2026!'});
  assert.equal((await api('source')).configured,false);
  const configure=async(token:string)=>{
    const status=await api('source'),review=await api('source/check',{version:status.version,baseUrl:`http://127.0.0.1:${upstreamPort}`,token});
    await api('source/save',{reviewId:review.reviewId,assignments:review.candidates.map((c:{suggestedId:string})=>c.suggestedId),pingKeys:Array(8).fill(''),confirmed:true});
  };
  await configure('synthetic-token');const identity=(await store.state()).source!.bindings[0]!.id;
  let response=await fetch(origin+'/api/servers');assert.equal(response.status,200);assert.ok((await response.text()).includes(identity));
  const ws=new WebSocket(origin.replace('http:','ws:')+'/api/ws',{headers:{Origin:origin}});t.after(()=>ws.terminate());
  const frame=new Promise<void>((done,reject)=>{ws.on('message',data=>{if(data.toString().includes('batchUpdate'))done()});ws.on('error',reject)});
  await new Promise<void>(done=>ws.once('open',done));ws.send(JSON.stringify({type:'subscribe',scope:'all',ids:[]}));
  await Promise.race([frame,delay(4000).then(()=>{throw new Error('no realtime frame')})]);
  const downstreamClosed=new Promise<void>(done=>ws.once('close',()=>done()));snapshot={...snapshot,servers:[{name:'node-one',cpu_pct:77}]};
  await configure('');await downstreamClosed;
  // The peer observes upstream closure asynchronously, independently of downstream close.
  for(let i=0;i<100&&closed===0;i++)await delay(10);
  assert.ok(closed>0);
  assert.equal((await store.state()).source!.bindings[0]!.id,identity);
  response=await fetch(origin+'/api/servers');assert.ok((await response.text()).includes('77'));
  await stop(child);child=await launch();assert.equal((await api('source')).version,2);
  assert.equal((await store.state()).source!.bindings[0]!.id,identity);
  assert.ok(!logs.includes('synthetic-token'));await stop(child);
});
