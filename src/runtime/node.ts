import { createNativeBuilder } from './native-build.ts';
import { createStoreTransport } from './store-transport.ts';
import { StoreNetwork } from '../management/store-network.ts';
import { setGlobalDispatcher } from 'undici';
import { createDevTransport } from './proxy.ts';
import { createServer,type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkStorage } from './storage-check.ts';
import { WebSocket,WebSocketServer } from 'ws';
import { readConfig } from '../core/config.ts';
import { managementConfig,PREVIEW_PARAMETER } from '../management/config.ts';
import { errorResponse } from '../core/http.ts';
import type { Socket } from '../core/socket.ts';
import { BridgeError } from '../core/errors.ts';
import { FileThemeStore } from './file-theme-store.ts';
import { seedBundled } from '../themes/bundled.ts';
import { Site } from '../app/site.ts';
import { loadRuntimeEnv,themeStoreDirectory } from './environment.ts';
import { sourceSocket } from './source-socket.ts';
import { readNodeRuntimeConfig,nodeRequest,isTrustedProxy,isLoopback } from './node-request.ts';

process.umask(0o077);
let env,config,management,runtime,storeDirectory;
try{
  env=await loadRuntimeEnv(process.env);config=readConfig(env);management=managementConfig(env);runtime=readNodeRuntimeConfig(env);
  if(runtime.mode!=='local'&&config.access==='local')throw new BridgeError('NODE_CONFIGURATION',503,'direct/proxy 模式须显式设置 BRIDGE_ACCESS=public 或 private。');
  storeDirectory=await themeStoreDirectory(env);
}catch(error){
  console.error(error instanceof BridgeError ? `LeoBridge configuration is invalid [${error.code}]: ${error.message}` : 'LeoBridge configuration is invalid. See docs/configuration.md and docs/deployment/docker.md.');
  process.exit(1);
}
// Read-only preflight: no listener, theme store, network transport or state writes.
if(process.argv.includes('--check-config')){
  console.log(JSON.stringify({valid:true,mode:runtime.mode,routing:management.routing,listenHost:runtime.host,listenPort:runtime.port,origin:management.displayOrigin,adminOrigin:management.adminOrigin,previewOrigin:management.previewOrigin}));
  process.exit(0);
}
const store=new FileThemeStore(storeDirectory);
try{
  await checkStorage(store.root);
  await store.state();
}catch(error){
  console.error(error instanceof BridgeError ? `LeoBridge startup failed [${error.code}]: ${error.message}` : 'LeoBridge storage check failed. Check data directory permissions and disk status.');
  process.exit(1);
}
const transport=createDevTransport(env.BRIDGE_DEV_PROXY,config.timeoutMs);setGlobalDispatcher(transport.http);
if(transport.proxied)console.log('Local development proxy enabled for HTTP and WebSocket.');
const assets=resolve(env.BRIDGE_ASSETS_DIR||'dist/bundled');
try{await seedBundled(store,async path=>new Uint8Array(await readFile(resolve(assets,path))));}
catch(error){console.error(error instanceof BridgeError ? `Theme initialization failed [${error.code}]: ${error.message}` : 'Theme initialization failed. Verify the complete release package/image and storage; source compilation is not required for prebuilt releases.');await transport.http.close();transport.webSocket?.destroy();process.exit(1);}
const storeTransport=createStoreTransport();
const nativeBuilder=createNativeBuilder();
const storeNetwork=new StoreNetwork(store,storeTransport.run,nativeBuilder);
const site=new Site(config,management,store,async path=>new Response(new Uint8Array(await readFile(resolve(assets,'_management',path))),{headers:{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8'}}),storeNetwork);
function socket(ws:WebSocket):Socket{return {send:data=>ws.send(data),close:(code,reason)=>ws.close(code,reason),onMessage:fn=>ws.on('message',data=>fn(data.toString())),onClose:fn=>ws.on('close',fn),onError:fn=>ws.on('error',fn)};}
const wss=new WebSocketServer({noServer:true,maxPayload:65536});
const rootSessions=new Set<{close:()=>void}>();
site.onActiveThemeChange=()=>{for(const session of rootSessions)session.close();};
const sessions=new Set<{close:()=>void}>(),sources=new Set<WebSocket>();
let shuttingDown=false;
let reportedUntrustedProxy=false;
function reportProxyError(error:unknown,req:IncomingMessage){
  if(!reportedUntrustedProxy&&error instanceof BridgeError&&error.code==='UNTRUSTED_PROXY'){
    reportedUntrustedProxy=true;
    // Socket peer only; never log request headers, paths, cookies or source secrets.
    console.warn(`UNTRUSTED_PROXY: peer=${req.socket.remoteAddress}; configure BRIDGE_TRUSTED_PROXIES for the verified proxy source. Further warnings suppressed until restart.`);
  }
}
const connect=(sourceConfig:typeof config)=>()=>new Promise<Socket>((accept,reject)=>{
  if(shuttingDown){reject(new BridgeError('SHUTTING_DOWN',503,'服务正在停止。'));return;}
  const url=new URL('/api/public/probe-ws',sourceConfig.baseUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const source=new WebSocket(url,{headers:{'X-MMwx-Probe-Token':sourceConfig.token},handshakeTimeout:sourceConfig.timeoutMs,maxPayload:12_000_000,followRedirects:false,agent:transport.webSocket});
  const adapted=sourceSocket(source);
  sources.add(source);source.once('close',()=>sources.delete(source));
  source.once('open',()=>accept(adapted));source.on('error',()=>reject(new BridgeError('UPSTREAM_WS',502,'上游实时连接失败。')));
});
async function body(req:IncomingMessage){
  if(req.method==='GET'||req.method==='HEAD')return undefined;
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>131072)throw new BridgeError('REQUEST_TOO_LARGE',413,'请求过大。');chunks.push(chunk);}
  return chunks.length?Buffer.concat(chunks):undefined;
}
const ports=runtime.mode!=='local'||management.routing==='single'?[runtime.port]:[...new Set([management.displayOrigin,management.adminOrigin,management.previewOrigin].map(origin=>Number(new URL(origin).port||80)))];
let listening=0;
const servers=ports.map(port=>{
  const server=createServer(async(req,res)=>{
    let response:Response;
    try{
      if(shuttingDown){res.writeHead(503,{Connection:'close'});res.end();return;}
      if(req.url==='/healthz'&&req.method==='GET'&&(isLoopback(req.socket.remoteAddress)||isTrustedProxy(runtime,req.socket.remoteAddress))){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"status":"ok"}');return;
      }
      // Validate peer/origin before waiting for a request body, including WS upgrades.
      nodeRequest(req,runtime,management,undefined,port);
      response=await site.fetch(nodeRequest(req,runtime,management,await body(req),port));
    }catch(error){reportProxyError(error,req);response=errorResponse(error);}
    if(!res.destroyed){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
  });
  server.headersTimeout=15_000;server.requestTimeout=120_000;server.keepAliveTimeout=5000;
  server.on('upgrade',async(req,connection,head)=>{
    try{
      if(shuttingDown||sessions.size>=50){connection.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
      const request=nodeRequest(req,runtime,management,undefined,port),url=new URL(request.url),protocol=await site.websocket(request);
      if(!protocol||shuttingDown||sessions.size>=50){connection.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      const sourceConfig=site.config;
      wss.handleUpgrade(req,connection,head,ws=>{const session=protocol.openRealtime(socket(ws),connect(sourceConfig),url.pathname);sessions.add(session);if(management.routing==='single'&&url.origin===management.displayOrigin&&!url.searchParams.has(PREVIEW_PARAMETER))rootSessions.add(session);ws.on('close',()=>{sessions.delete(session);rootSessions.delete(session);});});
    }catch(error){reportProxyError(error,req);connection.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  });
  server.once('error',()=>{console.error('LeoBridge listener failed; check address and port availability.');process.exitCode=1;shutdown();});
  server.listen(port,runtime.host,()=>{
    console.log(`LeoBridge ${runtime.mode} listener: ${runtime.host}:${port}`);
    if(++listening===ports.length&&!shuttingDown)process.send?.({type:'ready',admin:management.adminOrigin+(management.routing==='single'?'/admin/':'/')});
  });return server;
});
console.log(`Display: ${management.displayOrigin}; administration: ${management.adminOrigin}${management.routing==='single'?'/admin/':'/'}`);
function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  if(process.connected)process.disconnect();
  for(const session of sessions)session.close();
  for(const source of sources)source.terminate();
  wss.close();for(const server of servers)server.close();
  nativeBuilder.close();
  void storeTransport.destroy();
  void transport.http.destroy().catch(()=>{/* already closed */});transport.webSocket?.destroy();
  // Bound draining for hostile/idle clients. The deadline does not keep an idle process alive.
  const deadline=setTimeout(()=>{for(const ws of wss.clients)ws.terminate();for(const server of servers)server.closeAllConnections();},5000);deadline.unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
// The local manager owns this process. Do not leave an orphan writer if it dies.
if(process.connected)process.on('disconnect',shutdown);
