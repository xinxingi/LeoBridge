/** Explicit local-workerd acceptance. Never targets Node production/dev state,
 * cloud services, catalogs or remote downloads. Mutations are login, selecting
 * existing local bundles, rollback, and logout on port 8795 only.
 * BRIDGE_RUNTIME_PASSWORD must contain the synthetic local-worker test password.
 */
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';

process.umask(0o077);
const admin=new URL('http://admin.worker.localhost:8795');
const password=process.env.BRIDGE_RUNTIME_PASSWORD;
if(!password)throw new Error('Set BRIDGE_RUNTIME_PASSWORD for the synthetic local-worker admin.');
const directory=resolve('work/private/worker-themes',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true,mode:0o700});
const records:Record<string,unknown>[]=[];
let cookie='',csrf='',cfsmId='',komariId='',displayOrigin='',restored=false,loggedOut=false;
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function record(name:string,pass:boolean,details:Record<string,unknown>={}){const result={case:name,pass,...details};records.push(result);console.log(JSON.stringify(result));return pass;}
function requireCheck(name:string,pass:boolean,details:Record<string,unknown>={}){if(!record(name,pass,details))throw new Error(name);}
function localUrl(input:string|URL):URL {
  const url=new URL(input);
  if(url.protocol!=='http:'||url.port!=='8795'||!(url.hostname==='127.0.0.1'||url.hostname.endsWith('.worker.localhost'))||url.username||url.password)throw new Error('Local worker target validation failed');
  return url;
}
interface Reply {status:number|null;headers:Record<string,string|string[]|undefined>;bytes:Buffer;body:unknown;}
async function capture(label:string,input:string|URL,options:{method?:string;body?:unknown;headers?:Record<string,string>;timeout?:number}={}):Promise<Reply> {
  const url=localUrl(input),method=options.method??'GET',body=options.body===undefined?undefined:JSON.stringify(options.body);
  const headers:Record<string,string>={Host:url.host,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body)),Origin:url.origin}),...options.headers};
  if(url.origin===admin.origin&&cookie&&!('Cookie' in headers))headers.Cookie=cookie;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout??110_000);
  return new Promise(resolveReply=>{
    let finished=false;
    const done=(reply:Reply)=>{if(finished)return;finished=true;clearTimeout(timer);resolveReply(reply);};
    const req=request({hostname:'127.0.0.1',port:8795,path:url.pathname+url.search,method,headers,signal:controller.signal},response=>{
      const chunks:Buffer[]=[];let count=0;
      response.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>20_000_000){controller.abort();return;}chunks.push(chunk);});
      response.on('error',()=>done({status:response.statusCode??null,headers:response.headers,bytes:Buffer.alloc(0),body:undefined}));
      response.on('end',()=>{
        const bytes=Buffer.concat(chunks);let parsed:unknown;
        try{parsed=JSON.parse(bytes.toString('utf8'));}catch{/* static artifacts are not JSON */}
        void writeFile(resolve(directory,`${label}.raw`),bytes,{mode:0o600}).then(()=>done({status:response.statusCode??null,headers:response.headers,bytes,body:parsed}));
      });
    });
    req.on('error',()=>done({status:null,headers:{},bytes:Buffer.alloc(0),body:undefined}));req.end(body);
  });
}
const adminCall=(label:string,path:string,body?:unknown,headers:Record<string,string>={})=>capture(label,new URL(path,admin),{method:body===undefined?'GET':'POST',body,headers:{...(body===undefined?{}:{'X-CSRF-Token':csrf}),...headers}});
async function state(label:string) {
  const response=await adminCall(label,'/manage/api/state');
  if(response.status!==200||!isRecord(response.body)||!isRecord(response.body.installations)||!isRecord(response.body.links)||typeof response.body.generation!=='number')throw new Error('Invalid worker state');
  return response.body;
}
function link(state:Record<string,unknown>,id:string,preview=false):URL {
  const links=state.links as Record<string,Record<string,string>>;
  return localUrl(links[id]![preview?'preview':'display']!);
}
async function verifyRedirect(label:string,root:string,expected:URL){
  const response=await capture(label,new URL('/',root));
  const location=response.headers.location;
  record(label,response.status===307&&typeof location==='string'&&new URL(location).origin===expected.origin&&response.headers['cache-control']==='no-store',{status:response.status});
}
async function assets(state:Record<string,unknown>,id:string,origin:URL) {
  const item=(state.installations as Record<string,Record<string,unknown>>)[id]!;
  const files=item.files as Record<string,{size:number;offset?:number;contentType:string}>;
  const html=await capture('komari-html',new URL('/',origin),{headers:{Accept:'text/html'}});
  const htmlText=html.bytes.toString('utf8'),scriptPath=htmlText.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  record('komari-html',html.status===200&&String(html.headers['content-type']).includes('text/html')&&!!scriptPath,{status:html.status,bytes:html.bytes.length});
  const paths=new Set<string>([String(item.entry)]);
  if(scriptPath){const url=new URL(scriptPath,origin);if(url.origin!==origin.origin)throw new Error('Unexpected remote script');paths.add(decodeURIComponent(url.pathname.slice(1)));}
  const rangeAsset=Object.entries(files).find(([path,info])=>(info.offset??0)>0&&/\.(?:js|css)$/.test(path));if(rangeAsset)paths.add(rangeAsset[0]);
  let inspected=0,nonzero=0,valid=true;
  for(const path of paths){
    if(path.split('/').some(part=>part==='..'||part==='.')||!files[path])throw new Error('Invalid local asset path');
    const response=path===item.entry?html:await capture(`komari-asset-${inspected}`,new URL(`/${path}`,origin));
    let same=false;try{same=hash(response.bytes)===hash(await readFile(resolve('dist/bundled',id,path)));}catch{/* exact build artifact unavailable is a failed check */}
    valid&&=response.status===200&&response.bytes.length===files[path]!.size&&same;
    if((files[path]!.offset??0)>0)nonzero++;inspected++;
  }
  record('r2-nonzero-range-bytes',valid&&nonzero>0,{assets_checked:inspected,nonzero_offset_assets:nonzero,full_file_hashes_match:valid});
  // HTTP Range is not an implemented feature; R2's internal slicing is the requirement.
  if(scriptPath){const response=await capture('http-range-observation',new URL(scriptPath,origin),{headers:{Range:'bytes=0-31'}});record('http-range-observation',response.status===200,{status:response.status,browser_range_supported:false});}
}
let rpcId=0;
async function rpc(label:string,origin:URL,method:string,params:Record<string,unknown>={}){
  const id=++rpcId,response=await capture(label,new URL('/api/rpc2',origin),{method:'POST',body:{jsonrpc:'2.0',id,method,params}});
  const envelope=isRecord(response.body)?response.body:undefined;
  return {response,value:envelope?.result,valid:response.status===200&&envelope?.jsonrpc==='2.0'&&envelope?.id===id&&Object.hasOwn(envelope,'result')&&!envelope.error};
}
async function komariHistory(origin:URL,id:string,hours:number,ping:boolean){
  const label=`komari-${ping?'ping':'load'}-${hours}h`,check=await rpc(label,origin,ping?'public:getPingRecords':'public:getRecordsByUUID',{uuid:id,hours:String(hours),...(!ping?{load_type:'all'}:{})});
  const rows=isRecord(check.value)&&Array.isArray(check.value.records)?check.value.records:[];
  const times=rows.flatMap(row=>isRecord(row)&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))?[Date.parse(row.time)]:[]);
  const measured=rows.filter(row=>isRecord(row)&&(ping?typeof row.value==='number'&&row.value>=0:typeof row.cpu==='number'||typeof row.ram==='number')).length;
  record(label,check.valid&&rows.length>0&&times.length===rows.length&&measured>0&&isRecord(check.value)&&check.value.count===rows.length,{status:check.response.status,rows:rows.length,measured_rows:measured,span_hours:times.length>1?(Math.max(...times)-Math.min(...times))/3_600_000:0,data_scope:'synthetic'});
}
async function socket(origin:URL,id:string){
  const start=Date.now(),native=new Set<number>(),digests=new Set<string>(),writes:Promise<void>[]=[];
  const result:Record<string,unknown>={status:null,responses:0,rpc_errors:0,native_observations:0,content_changed:false,data_scope:'synthetic'};
  return new Promise<void>(resolveCheck=>{
    const ws=new WebSocket('ws://127.0.0.1:8795/api/rpc2',{headers:{Host:origin.host,Origin:origin.origin},handshakeTimeout:15_000,followRedirects:false});
    let ended=false,inflight=false,next=100,frame=0,interval:ReturnType<typeof setInterval>|undefined;
    const finish=async()=>{
      if(ended)return;ended=true;clearTimeout(timer);clearInterval(interval);
      result.native_observations=native.size;result.content_changed=digests.size>=2;result.seconds=(Date.now()-start)/1000;
      if(ws.readyState===WebSocket.OPEN)await new Promise<void>(done=>{const timeout=setTimeout(()=>{result.forced_cleanup=true;ws.terminate();done();},2000);ws.once('close',()=>{clearTimeout(timeout);done();});ws.close(1000,'local acceptance complete');});
      else if(ws.readyState===WebSocket.CONNECTING)ws.terminate();
      await Promise.all(writes);record('komari-worker-websocket',Number(result.responses)>=3&&native.size>=2&&digests.size>=2&&result.invalid_response!==true,result);resolveCheck();
    };
    const timer=setTimeout(()=>{result.observation_limit_reached=true;void finish();},60_000);
    const send=()=>{if(ended||inflight||ws.readyState!==WebSocket.OPEN)return;inflight=true;ws.send(JSON.stringify({jsonrpc:'2.0',id:next++,method:'common:getNodesLatestStatus',params:{uuids:[id]}}));};
    ws.on('upgrade',response=>{result.status=response.statusCode;});ws.on('open',()=>{send();interval=setInterval(send,5000);});
    ws.on('message',data=>{
      if(ended)return;inflight=false;writes.push(writeFile(resolve(directory,`komari-ws-${frame++}.raw`),data.toString(),{mode:0o600}));
      let parsed:unknown;try{parsed=JSON.parse(data.toString());}catch{result.invalid_response=true;return;}
      if(!isRecord(parsed)||parsed.jsonrpc!=='2.0'){result.invalid_response=true;return;}
      if(parsed.error){result.rpc_errors=Number(result.rpc_errors)+1;return;}
      const status=isRecord(parsed.result)?parsed.result[id]:undefined;
      if(!isRecord(status)||!isRecord(status.bridge)){result.invalid_response=true;return;}
      result.responses=Number(result.responses)+1;
      if(status.bridge.transport==='websocket'&&typeof status.bridge.observed_at==='number')native.add(status.bridge.observed_at);
      digests.add(hash(Buffer.from(JSON.stringify(['cpu','ram','net_in','net_out','online'].map(key=>status[key])))));
      if(Number(result.responses)>=3&&native.size>=2&&digests.size>=2)void finish();
    });
    ws.on('error',()=>{result.failure='WEBSOCKET_ERROR';});ws.on('close',code=>{result.close_code=code;void finish();});
  });
}

try {
  const denied=await adminCall('before-login','/manage/api/state');record('admin-before-login',denied.status===401,{status:denied.status});
  const login=await adminCall('login','/manage/api/login',{username:'admin',password});
  const setCookie=login.headers['set-cookie'];const firstCookie=Array.isArray(setCookie)?setCookie[0]:setCookie;
  requireCheck('admin-login',login.status===200&&isRecord(login.body)&&typeof login.body.csrf==='string'&&typeof firstCookie==='string',{status:login.status});
  csrf=(login.body as {csrf:string}).csrf;cookie=String(firstCookie).split(';')[0]!;
  record('admin-cookie-isolation',/HttpOnly/i.test(String(firstCookie))&&/SameSite=Strict/i.test(String(firstCookie))&&!/Domain=/i.test(String(firstCookie)));
  let current=await state('initial-state');
  record('state-hides-sessions',!Object.hasOwn(current,'sessions'));
  const definitions=JSON.parse(await readFile('dist/bundled/index.json','utf8')) as {id:string;ecosystem:string}[];
  const installations=current.installations as Record<string,unknown>;
  cfsmId=definitions.find(item=>item.ecosystem==='cfsm'&&installations[item.id])?.id??'';
  komariId=definitions.find(item=>item.ecosystem==='komari'&&installations[item.id])?.id??'';
  requireCheck('both-local-bundles-installed',!!cfsmId&&!!komariId,{installed_count:Object.keys(installations).length});
  displayOrigin=String(current.displayOrigin);localUrl(displayOrigin);
  const cfsmOrigin=link(current,cfsmId),komariOrigin=link(current,komariId),previewOrigin=link(current,komariId,true);
  const baseline=await capture('cfsm-fixture-baseline',new URL('/api/servers',cfsmOrigin));
  const servers=isRecord(baseline.body)&&Array.isArray(baseline.body.servers)?baseline.body.servers:[];
  requireCheck('synthetic-source-only',baseline.status===200&&servers.length>0&&servers.every(server=>isRecord(server)&&typeof server.name==='string'&&server.name.startsWith('Synthetic ')),{status:baseline.status,server_count:servers.length});
  if(current.active!==cfsmId){const result=await adminCall('prepare-cfsm','/manage/api/activate',{id:cfsmId,generation:current.generation,acknowledgeUnverified:true});requireCheck('prepare-cfsm',result.status===200,{status:result.status});current=await state('prepared-state');}
  await verifyRedirect('initial-cfsm-root',displayOrigin,cfsmOrigin);
  const generation=current.generation;
  const activate=await adminCall('activate-komari','/manage/api/activate',{id:komariId,generation,acknowledgeUnverified:true});
  requireCheck('activate-komari',activate.status===200&&isRecord(activate.body)&&activate.body.active===komariId,{status:activate.status});
  current=await state('komari-active-state');
  await verifyRedirect('komari-root-redirect',displayOrigin,komariOrigin);
  const preview=await capture('komari-preview-version',new URL('/__bridge/version',previewOrigin));
  record('komari-preview-isolated',preview.status===200&&isRecord(preview.body)&&preview.body.preview===true&&preview.body.ecosystem==='komari',{status:preview.status});
  await assets(current,komariId,komariOrigin);
  const foreign=await adminCall('foreign-origin','/manage/api/activate',{id:cfsmId,generation:current.generation,acknowledgeUnverified:true},{Origin:komariOrigin.origin});
  record('foreign-origin-rejected',foreign.status===403&&isRecord(foreign.body)&&foreign.body.code==='ORIGIN_REJECTED',{status:foreign.status});
  const csrfFailure=await adminCall('invalid-csrf','/manage/api/activate',{id:cfsmId,generation:current.generation,acknowledgeUnverified:true},{'X-CSRF-Token':'incorrect'});
  record('csrf-rejected',csrfFailure.status===403&&isRecord(csrfFailure.body)&&csrfFailure.body.code==='CSRF_REJECTED',{status:csrfFailure.status});
  const conflict=await adminCall('stale-generation','/manage/api/activate',{id:cfsmId,generation,acknowledgeUnverified:true});
  record('stale-generation-rejected',conflict.status===409&&isRecord(conflict.body)&&conflict.body.code==='REVISION_CONFLICT',{status:conflict.status});
  const preserved=await state('after-denied-mutations');record('rejections-preserve-active-generation',preserved.active===komariId&&preserved.generation===current.generation);
  const blocked=await capture('theme-admin-isolation',new URL('/manage/api/state',komariOrigin));record('theme-cannot-read-admin',blocked.status===404,{status:blocked.status});
  const nodes=await rpc('komari-nodes',komariOrigin,'public:getNodesInformation');
  const nodeList=Array.isArray(nodes.value)?nodes.value:[];const id=isRecord(nodeList[0])&&typeof nodeList[0].uuid==='string'?nodeList[0].uuid:undefined;
  requireCheck('komari-rpc-nodes',nodes.valid&&nodeList.length===servers.length&&!!id,{status:nodes.response.status,nodes:nodeList.length,data_scope:'synthetic'});
  for(const hours of [1,168])await Promise.all([komariHistory(komariOrigin,id!,hours,false),komariHistory(komariOrigin,id!,hours,true)]);
  await socket(komariOrigin,id!);
  const old=await capture('old-cfsm-servers',new URL('/api/servers',cfsmOrigin));
  record('old-cfsm-version-retains-protocol',old.status===200&&isRecord(old.body)&&Array.isArray(old.body.servers)&&old.body.servers.length===servers.length&&!Object.hasOwn(old.body,'jsonrpc'),{status:old.status,server_count:isRecord(old.body)&&Array.isArray(old.body.servers)?old.body.servers.length:0});
  current=await state('before-rollback');
  const rollback=await adminCall('rollback-cfsm','/manage/api/rollback',{generation:current.generation});
  requireCheck('rollback-cfsm',rollback.status===200&&isRecord(rollback.body)&&rollback.body.active===cfsmId,{status:rollback.status});restored=true;
  await verifyRedirect('cfsm-root-after-rollback',displayOrigin,cfsmOrigin);
  const logout=await adminCall('logout','/manage/api/logout',{});record('logout',logout.status===200,{status:logout.status});loggedOut=logout.status===200;
  const afterLogout=await adminCall('after-logout','/manage/api/state');record('logout-session-revoked',afterLogout.status===401,{status:afterLogout.status});
}catch{
  record('run-interrupted',false,{failure:'DEPENDENT_CHECK_FAILED_OR_LOCAL_RUNTIME_ERROR'});
}finally{
  if(cookie&&!loggedOut){
    if(!restored&&cfsmId){try{const current=await state('cleanup-state');if(current.active!==cfsmId){const restoredReply=await adminCall('cleanup-cfsm','/manage/api/activate',{id:cfsmId,generation:current.generation,acknowledgeUnverified:true});record('cleanup-restores-cfsm',restoredReply.status===200,{status:restoredReply.status});}}catch{record('cleanup-restores-cfsm',false);}}
    const logout=await adminCall('cleanup-logout','/manage/api/logout',{});record('cleanup-logout',logout.status===200,{status:logout.status});
  }
}
const summary={scope:'local-workerd-with-synthetic-upstream',cloud_deployment_executed:false,remote_packages_downloaded:false,cases:records,all_checks_passed:records.every(result=>result.pass===true)};
await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
console.log(JSON.stringify({acceptance:'complete',all_checks_passed:summary.all_checks_passed,private_evidence_directory:directory}));
if(!summary.all_checks_passed)process.exitCode=1;
