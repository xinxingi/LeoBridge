/** Synthetic-only browser fixture. Never reads real source credentials or data. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
const upstreamPort=8791,displayPort=8790;
let tick=0;
const snapshot=()=>({enabled:true,show_name:true,history_days:7,servers:[
  {name:'Synthetic online',online:true,cpu_pct:tick%25,mem_used:0,mem_total:1024**3,disk_used:1024**3,disk_total:10*1024**3,download_speed:tick*1024,upload_speed:0,uptime:3600,region_country:'US',os:'Debian',arch:'amd64',cpu_threads:2,loadavg:'0.00 0.00 0.00 1/50 100',ping:[{key:'target-a',label:'Synthetic target',current_ms:tick%2?20:0,loss_pct:0}]},
  {name:'Synthetic offline',online:false,last_seen:new Date().toISOString()},
  {name:'Synthetic missing',online:true},
]});
const server=createServer((req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  if(req.headers['x-mmwx-probe-token']!=='synthetic-token'){res.writeHead(404);res.end();return;}
  let body:unknown;
  if(url.pathname==='/api/public/probe-servers')body=snapshot();
  else if(url.pathname==='/api/public/probe-series') {
    const range=url.searchParams.get('range')||'1h';
    const bucket=({ '1h':300,'6h':600,'24h':1800,'7d':7200 } as Record<string,number>)[range];
    if(!bucket){res.writeHead(400);res.end();return;}
    const generated_at=Math.floor(Date.now()/1000),last=Math.floor(generated_at/bucket)*bucket;
    const points=(value:number)=>Array.from({length:10},(_,i)=>({t:last-(9-i)*bucket,value:value+i}));
    body=url.searchParams.get('metric')==='ping'?{success:true,bucket_sec:bucket,generated_at,all_series:[{key:'target-a',buckets:Array.from({length:10},(_,i)=>({ms:i===3?-1:i*10,loss:i===3?-1:0}))}]}:{success:true,bucket_sec:bucket,generated_at,series:{cpu_pct:points(0),mem_used:points(0),mem_total:points(1024**3),download_speed:points(0),upload_speed:points(0)}};
  } else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/api/public/probe-ws'||req.headers['x-mmwx-probe-token']!=='synthetic-token'){socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>{ws.send(JSON.stringify(snapshot()));});
});
const timer=setInterval(()=>{tick++;for(const ws of wss.clients)if(ws.readyState===1)ws.send(JSON.stringify(snapshot()));},5000);
await new Promise<void>(resolve=>server.listen(upstreamPort,'127.0.0.1',resolve));
const child=spawn(process.execPath,['--import','tsx','src/runtime/node.ts'],{stdio:'inherit',env:{...process.env,PORT:String(displayPort),BRIDGE_ADMIN_ORIGIN:'http://admin.fixture.localhost:8793',BRIDGE_DISPLAY_DOMAIN:'display.fixture.localhost',BRIDGE_PREVIEW_ORIGIN:'http://preview.fixture.localhost:8794',BRIDGE_THEME_STORE:'work/private/fixture-theme-store',MMWX_BASE_URL:`http://127.0.0.1:${upstreamPort}`,MMWX_PROBE_TOKEN:'synthetic-token',BRIDGE_ACCESS:'local',BRIDGE_DEV_PROXY:'',BRIDGE_TITLE:'LeoBridge Synthetic Fixture',BRIDGE_BINDINGS:JSON.stringify(snapshot().servers.map((s,i)=>({id:`synthetic-${i+1}`,match:{name:s.name}}))),BRIDGE_PING_TARGETS:JSON.stringify({ct:{key:'target-a',label:'Synthetic target'}})}});
console.log(`Synthetic fixture only: http://127.0.0.1:${displayPort}`);
function close(){clearInterval(timer);child.kill('SIGTERM');for(const ws of wss.clients)ws.close();wss.close();server.close();}
process.on('SIGINT',close);process.on('SIGTERM',close);child.on('exit',close);
