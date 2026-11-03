/** Opt-in, read-only Komari protocol acceptance against a local bridge.
 * No upstream configuration or credentials are read. Private raw responses stay
 * in an independent ignored run directory; stdout contains structural evidence.
 * BRIDGE_VERIFY_ORIGIN=http://p-<installation>.preview.localhost:8789
 */
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';

process.umask(0o077);
const originArgument=process.argv.find(arg=>arg.startsWith('--origin='))?.slice(9)
  ??(process.argv.includes('--origin')?process.argv[process.argv.indexOf('--origin')+1]:undefined);
const origin=new URL(originArgument??process.env.BRIDGE_VERIFY_ORIGIN??'http://localhost:8787');
if(origin.protocol!=='http:'||!(origin.hostname==='localhost'||origin.hostname==='127.0.0.1'||origin.hostname.endsWith('.localhost'))
  ||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('Verification requires a local HTTP bridge origin.');
const cases=['nodes','settings','latest','recent','load-1h','ping-1h','load-7d','ping-7d','ws'];
const requested=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',')??cases;
if(requested.some(value=>!cases.includes(value)))throw new Error('Unknown verification case.');
const selected=new Set(requested);
const directory=resolve('work/private/komari-acceptance',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true,mode:0o700});
const port=Number(origin.port||80);
const headers:Record<string,string>={Host:origin.host,Origin:origin.origin,Accept:'application/json','Content-Type':'application/json'};
// Optional display-site authentication is separate from the source probe token.
if(process.env.BRIDGE_VERIFY_USERNAME&&process.env.BRIDGE_VERIFY_PASSWORD)headers.Authorization=`Basic ${Buffer.from(`${process.env.BRIDGE_VERIFY_USERNAME}:${process.env.BRIDGE_VERIFY_PASSWORD}`,'utf8').toString('base64')}`;
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const results:Record<string,unknown>[]=[];
const save=(label:string,value:unknown)=>writeFile(resolve(directory,`${label}.json`),JSON.stringify(value,null,2),{mode:0o600});
function report(result:Record<string,unknown>){results.push(result);console.log(JSON.stringify(result));}
let sequence=0;
async function call(label:string,method:string,params:Record<string,unknown>={},timeout=40_000):Promise<{value:unknown;result:Record<string,unknown>}> {
  const start=Date.now(),id=++sequence,body=JSON.stringify({jsonrpc:'2.0',id,method,params});
  return new Promise(resolveRequest=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    let settled=false;
    const done=(value:unknown,result:Record<string,unknown>)=>{if(settled)return;settled=true;clearTimeout(timer);resolveRequest({value,result:{case:label,seconds:(Date.now()-start)/1000,...result}});};
    const req=httpRequest({hostname:'127.0.0.1',port,path:'/api/rpc2',method:'POST',headers:{...headers,'Content-Length':Buffer.byteLength(body)},signal:controller.signal},response=>{
      const chunks:Buffer[]=[];let bytes=0;
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>12_000_000){controller.abort();return;}chunks.push(chunk);});
      response.on('error',()=>done(undefined,{status:response.statusCode??null,pass:false,failure:'RESPONSE_STREAM_ERROR'}));
      response.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        void writeFile(resolve(directory,`${label}.raw`),text,{mode:0o600}).then(()=>{
          let parsed:unknown;try{parsed=JSON.parse(text);}catch{/* never echo the raw failure */}
          const envelope=isRecord(parsed)?parsed:undefined;
          const valid=envelope?.jsonrpc==='2.0'&&envelope?.id===id;
          const error=valid&&isRecord(envelope?.error)?envelope.error:undefined;
          const sourceCode=error&&isRecord(error.data)&&typeof error.data.bridge_code==='string'&&/^[A-Z_]+$/.test(error.data.bridge_code)?error.data.bridge_code:undefined;
          const pass=response.statusCode===200&&valid&&!error&&envelope!==undefined&&Object.hasOwn(envelope,'result');
          done(valid?envelope?.result:undefined,{status:response.statusCode??null,jsonrpc_valid:valid,pass,...(error?{rpc_error_code:error.code,bridge_code:sourceCode}:{}),...(!valid?{failure:'INVALID_RPC_RESPONSE'}:{})});
        }).catch(()=>done(undefined,{pass:false,failure:'PRIVATE_EVIDENCE_WRITE_FAILED'}));
      });
    });
    req.on('error',(error:NodeJS.ErrnoException)=>done(undefined,{status:null,pass:false,failure:controller.signal.aborted?'CLIENT_TIMEOUT':'LOCAL_TRANSPORT_ERROR',
      ...(['ECONNREFUSED','EPERM','EACCES','ECONNRESET','ETIMEDOUT'].includes(error.code??'')?{transport_code:error.code}:{})}));
    req.end(body);
  });
}

let serverId:string|undefined;
const nodes=await call('nodes','public:getNodesInformation');
const values=Array.isArray(nodes.value)?nodes.value:[];
const ids=values.flatMap(value=>isRecord(value)&&typeof value.uuid==='string'?[value.uuid]:[]);
nodes.result.shape_valid=Array.isArray(nodes.value)&&ids.length===values.length&&new Set(ids).size===ids.length;
nodes.result.server_count=values.length;
nodes.result.pass=nodes.result.pass===true&&nodes.result.shape_valid===true&&ids.length>0;
if(nodes.result.pass)serverId=ids[0];report(nodes.result);

if(selected.has('settings')) {
  const check=await call('settings','public:getPublicSettings');
  check.result.shape_valid=isRecord(check.value)&&typeof check.value.sitename==='string'&&isRecord(check.value.bridge)&&Array.isArray(check.value.bridge.history_hours);
  check.result.history_7d_declared=isRecord(check.value)&&isRecord(check.value.bridge)&&Array.isArray(check.value.bridge.history_hours)&&check.value.bridge.history_hours.includes(168);
  check.result.pass=check.result.pass===true&&check.result.shape_valid===true;report(check.result);
}
if(selected.has('latest')) {
  const check=await call('latest','common:getNodesLatestStatus');
  const records=isRecord(check.value)?Object.values(check.value):[];
  check.result.shape_valid=isRecord(check.value)&&records.length===ids.length&&records.every(record=>isRecord(record)&&typeof record.time==='string'&&Number.isFinite(Date.parse(record.time))&&isRecord(record.bridge)&&(record.online===true||record.online===false||record.online===null));
  check.result.server_count=records.length;check.result.online_count=records.filter(record=>isRecord(record)&&record.online===true).length;
  check.result.pass=check.result.pass===true&&check.result.shape_valid===true;report(check.result);
}
if(selected.has('recent')) {
  if(!serverId)report({case:'recent',pass:false,failure:'NO_SERVER_ID'});
  else {
    const check=await call('recent','public:getClientRecentRecords',{uuid:serverId});
    const records=Array.isArray(check.value)?check.value:[];
    check.result.shape_valid=Array.isArray(check.value)&&records.every(record=>isRecord(record)&&record.uuid===serverId&&typeof record.updated_at==='string'&&Number.isFinite(Date.parse(record.updated_at))&&isRecord(record.cpu));
    check.result.observed_samples=records.length;check.result.pass=check.result.pass===true&&check.result.shape_valid===true;report(check.result);
  }
}

async function history(label:string,hours:number,ping:boolean) {
  if(!serverId){report({case:label,pass:false,failure:'NO_SERVER_ID'});return;}
  const check=await call(label,ping?'public:getPingRecords':'public:getRecordsByUUID',{uuid:serverId,hours:String(hours),...(!ping?{load_type:'all'}:{})},110_000);
  const records=isRecord(check.value)&&Array.isArray(check.value.records)?check.value.records:[];
  const timestamps=records.flatMap(record=>isRecord(record)&&typeof record.time==='string'&&Number.isFinite(Date.parse(record.time))?[Date.parse(record.time)]:[]);
  const span=timestamps.length>1?(Math.max(...timestamps)-Math.min(...timestamps))/3_600_000:0;
  const sorted=timestamps.every((time,index)=>index===0||time>=timestamps[index-1]!);
  check.result.row_count=records.length;check.result.span_hours=Math.round(span*1e6)/1e6;
  check.result.shape_valid=isRecord(check.value)&&check.value.count===records.length&&timestamps.length===records.length&&sorted&&span<=hours&&records.every(record=>isRecord(record)&&record.client===serverId);
  if(ping){
    const tasks=isRecord(check.value)&&Array.isArray(check.value.tasks)?check.value.tasks:[];
    const taskIds=new Set(tasks.flatMap(task=>isRecord(task)&&typeof task.id==='number'?[task.id]:[]));
    check.result.task_count=tasks.length;check.result.task_ids_valid=taskIds.size===tasks.length&&records.every(record=>isRecord(record)&&typeof record.task_id==='number'&&taskIds.has(record.task_id));
    check.result.measured_rows=records.filter(record=>isRecord(record)&&typeof record.value==='number'&&record.value>=0).length;
    check.result.loss_rows=records.filter(record=>isRecord(record)&&typeof record.loss_percent==='number').length;
    check.result.pass=check.result.pass===true&&check.result.shape_valid===true&&check.result.task_ids_valid===true&&Number(check.result.measured_rows)>0;
  }else{
    check.result.measured_rows=records.filter(record=>isRecord(record)&&['cpu','ram','disk','net_in','net_out'].some(field=>typeof record[field]==='number')).length;
    check.result.pass=check.result.pass===true&&check.result.shape_valid===true&&Number(check.result.measured_rows)>0;
  }
  report(check.result);
}
// Parallel load/Ping requests for a range exercise the shared neutral-series read.
for(const [range,hours]of [['1h',1],['7d',168]] as const)await Promise.all([
  selected.has(`load-${range}`)?history(`load-${range}`,hours,false):undefined,
  selected.has(`ping-${range}`)?history(`ping-${range}`,hours,true):undefined,
]);

const metricKeys=['online','cpu','ram','ram_total','disk','disk_total','net_in','net_out','connections','connections_udp'];
async function websocket(id:string):Promise<Record<string,unknown>> {
  const start=Date.now(),nativeObservations=new Set<number>(),digests=new Set<string>(),writes:Promise<void>[]=[];
  const result:Record<string,unknown>={case:'ws',status:null,responses:0,rpc_errors:0,measured_content_changed:false,native_ws_observed:false,native_ws_continuity_passed:false,pass:false};
  const transports={websocket:0,poll:0,unknown:0};result.transport_counts=transports;
  return new Promise(resolveResult=>{
    let ended=false,nextId=1000,inflight=false,frame=0;
    const ws=new WebSocket(`ws://127.0.0.1:${port}/api/rpc2`,{headers,handshakeTimeout:10_000,followRedirects:false,maxPayload:12_000_000});
    let interval:ReturnType<typeof setInterval>|undefined,progress:ReturnType<typeof setInterval>|undefined;
    const end=async()=>{
      if(ended)return;ended=true;clearTimeout(limit);clearInterval(interval);clearInterval(progress);
      result.seconds=(Date.now()-start)/1000;result.native_observation_count=nativeObservations.size;
      result.native_ws_observed=nativeObservations.size>0;result.native_ws_continuity_passed=nativeObservations.size>=2;
      result.measured_content_changed=digests.size>=2;result.downstream_messages_passed=Number(result.responses)>=3&&result.invalid_response!==true;
      result.pass=result.downstream_messages_passed===true&&result.native_ws_continuity_passed===true&&result.measured_content_changed===true;
      if(ws.readyState===WebSocket.OPEN){
        result.acceptance_requested_close=true;
        await new Promise<void>(closed=>{
          const cleanup=setTimeout(()=>{result.forced_cleanup=true;ws.terminate();closed();},2000);
          ws.once('close',()=>{clearTimeout(cleanup);closed();});
          ws.close(1000,'acceptance complete');
        });
      }else if(ws.readyState===WebSocket.CONNECTING)ws.terminate();
      await Promise.all(writes);resolveResult(result);
    };
    const limit=setTimeout(()=>{result.observation_limit_reached=true;void end();},120_000);
    const send=()=>{if(ended||inflight||ws.readyState!==WebSocket.OPEN)return;inflight=true;ws.send(JSON.stringify({jsonrpc:'2.0',id:nextId++,method:'common:getNodesLatestStatus',params:{uuids:[id]}}));};
    ws.on('upgrade',response=>{result.status=response.statusCode;});
    ws.on('open',()=>{send();interval=setInterval(send,5000);progress=setInterval(()=>console.log(JSON.stringify({case:'ws-progress',responses:result.responses,native_observations:nativeObservations.size,transport_counts:transports})),30_000);});
    ws.on('message',buffer=>{
      if(ended)return;inflight=false;writes.push(writeFile(resolve(directory,`ws-frame-${frame++}.raw`),buffer.toString(),{mode:0o600}));
      let payload:unknown;try{payload=JSON.parse(buffer.toString());}catch{result.invalid_response=true;return;}
      if(!isRecord(payload)||payload.jsonrpc!=='2.0'||typeof payload.id!=='number'){result.invalid_response=true;return;}
      if(isRecord(payload.error)){result.rpc_errors=Number(result.rpc_errors)+1;return;}
      const value=isRecord(payload.result)?payload.result[id]:undefined;
      if(!isRecord(value)||!isRecord(value.bridge)||!Number.isFinite(value.bridge.observed_at)||typeof value.time!=='string'){result.invalid_response=true;return;}
      result.responses=Number(result.responses)+1;
      const transport=value.bridge.transport==='websocket'||value.bridge.transport==='poll'?value.bridge.transport:'unknown';transports[transport]++;
      if(transport==='websocket')nativeObservations.add(Number(value.bridge.observed_at));
      digests.add(createHash('sha256').update(JSON.stringify(Object.fromEntries(metricKeys.map(key=>[key,value[key]])))).digest('hex'));
      if(Number(result.responses)>=3&&nativeObservations.size>=2&&digests.size>=2)void end();
    });
    ws.on('error',()=>{result.failure='WEBSOCKET_ERROR';});ws.on('close',code=>{result.close_code=code;void end();});
  });
}
if(selected.has('ws'))report(serverId?await websocket(serverId):{case:'ws',pass:false,failure:'NO_SERVER_ID'});
const summary={requested_cases:requested,cases:results,all_requested_checks_passed:results.every(result=>result.pass===true)};
await save('summary',summary);console.log(JSON.stringify({acceptance:'complete',all_requested_checks_passed:summary.all_requested_checks_passed,private_evidence_directory:directory}));
if(!summary.all_requested_checks_passed)process.exitCode=1;
