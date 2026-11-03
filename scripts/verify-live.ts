/** Explicit opt-in, read-only local bridge acceptance. Never runs in unit tests.
 * Raw data is written only to the ignored private directory; stdout is structural.
 * Usage: node --import tsx scripts/verify-live.ts [--only=config,list,detail,history-1h,history-7d,ws]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { WebSocket } from 'ws';

process.umask(0o077);
const output = resolve('work/private/bridge-acceptance', new Date().toISOString().replace(/[:.]/g, '-'));
let base = new URL(process.env.BRIDGE_VERIFY_BASE_URL || process.env.BRIDGE_VERIFY_ORIGIN || 'http://127.0.0.1:8787');
const localHost=(host:string)=>['127.0.0.1','localhost','[::1]'].includes(host)||host.endsWith('.localhost');
if (!['http:', 'https:'].includes(base.protocol) || !localHost(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Verification requires a loopback bridge origin.');
}
const known = ['config', 'list', 'detail', 'history-1h', 'history-7d', 'ws'];
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',') || known;
if (only.some(label => !known.includes(label))) throw new Error('Unknown verification case.');
const selected = new Set(only);
await mkdir(output, { recursive: true, mode: 0o700 });
let vars: Record<string, string | undefined> = {};
try { vars = parseEnv(await readFile('.dev.vars', 'utf8')) as Record<string, string>; } catch { /* Environment-only configuration is supported. */ }
vars = { ...vars, ...process.env };
const headers: Record<string, string> = { Accept: 'application/json' };
if (vars.BRIDGE_ACCESS === 'private' && vars.BRIDGE_USERNAME && vars.BRIDGE_PASSWORD) {
  headers.Authorization = `Basic ${Buffer.from(`${vars.BRIDGE_USERNAME}:${vars.BRIDGE_PASSWORD}`).toString('base64')}`;
}
const records: Record<string, unknown>[] = [];
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
async function save(label: string, value: unknown) {
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
}
function report(value: Record<string, unknown>) { records.push(value); console.log(JSON.stringify(value)); }

// Resolve the immutable installation once. Subsequent HTTP/WS requests keep its
// origin even if an administrator changes the active theme during acceptance.
// Connect locally while retaining Host so *.localhost does not require DNS.
async function localHttp(url:URL,signal:AbortSignal):Promise<Response> {
  return new Promise((resolveResponse,reject)=>{
    const send=url.protocol==='https:'?httpsRequest:httpRequest;
    const request=send({hostname:'127.0.0.1',port:Number(url.port||(url.protocol==='https:'?443:80)),path:url.pathname+url.search,method:'GET',
      headers:{...headers,Host:url.host},signal,...(url.protocol==='https:'?{servername:url.hostname}:{})},response=>{
      const chunks:Buffer[]=[];let length=0;
      response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>12_000_000){response.destroy();reject(new Error('Local response too large'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{
        const resultHeaders=new Headers();for(const [key,value]of Object.entries(response.headers))if(value!==undefined)resultHeaders.set(key,Array.isArray(value)?value.join(', '):value);
        resolveResponse(new Response(Buffer.concat(chunks),{status:response.statusCode||502,headers:resultHeaders}));
      });
    });request.on('error',reject);request.end();
  });
}
async function resolveInstallation():Promise<boolean> {
  const initial=new URL(base),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40_000);
  let target=new URL('/__bridge/version',base),redirects=0;
  try {
    while(true){
      const response=await localHttp(target,controller.signal);
      if(response.status===307||response.status===308){
        const location=response.headers.get('location');if(!location||redirects++>=3)throw new Error('Invalid local redirect');
        const next=new URL(location,target);
        if(!localHost(next.hostname)||next.protocol!==initial.protocol||next.port!==initial.port||next.username||next.password)throw new Error('Nonlocal redirect rejected');
        target=next;continue;
      }
      const text=await response.text();await writeFile(resolve(output,'installation.raw'),text,{mode:0o600});
      let value:unknown;try{value=JSON.parse(text);}catch{/* structural failure below */}
      const pass=response.ok&&isRecord(value)&&value.ecosystem==='cfsm'&&value.protocolProfile==='cfsm-609cc0b';
      report({case:'installation-routing',status:response.status,redirect_count:redirects,pass,...(!pass?{failure:'EXPECTED_CFSM_INSTALLATION_USE_ITS_VERSION_ORIGIN'}:{})});
      if(pass)base=new URL('/',target);return pass;
    }
  }catch{report({case:'installation-routing',pass:false,failure:'LOCAL_INSTALLATION_RESOLUTION_FAILED'});return false;}
  finally{clearTimeout(timer);}
}
if(!await resolveInstallation()){
  const summary={requested_cases:only,cases:records,all_requested_checks_passed:false};await save('summary',summary);
  console.log(JSON.stringify({acceptance:'complete',all_requested_checks_passed:false}));process.exit(1);
}

async function request(label: string, path: string, limitMs = 40_000) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    const response = await localHttp(new URL(path, base),controller.signal);
    const text = await response.text();
    await writeFile(resolve(output, `${label}.raw`), text, { mode: 0o600 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { /* Report invalid JSON without echoing it. */ }
    return { body, result: { case: label, status: response.status, seconds: (Date.now() - start) / 1000, json: body !== undefined, pass: response.ok && body !== undefined } as Record<string, unknown> };
  } catch {
    return { body: undefined, result: { case: label, status: null, seconds: (Date.now() - start) / 1000, failure: controller.signal.aborted ? 'CLIENT_TIMEOUT' : 'TRANSPORT_ERROR', pass: false } as Record<string, unknown> };
  } finally { clearTimeout(timer); }
}

if (selected.has('config')) {
  const { body, result } = await request('config', '/api/config');
  result.shape_valid = isRecord(body) && isRecord(body.bridge) && Array.isArray(body.bridge.history_hours);
  result.pass = result.pass === true && result.shape_valid === true;
  report(result);
}

let id: string | undefined;
if ([...selected].some(label => label !== 'config')) {
  const { body, result } = await request('list', '/api/servers');
  const servers = isRecord(body) && Array.isArray(body.servers) ? body.servers : [];
  const ids = servers.flatMap(server => isRecord(server) && typeof server.id === 'string' && server.id ? [server.id] : []);
  result.server_count = servers.length;
  result.shape_valid = isRecord(body) && Array.isArray(body.servers) && ids.length === servers.length && new Set(ids).size === ids.length;
  result.pass = result.pass === true && result.shape_valid === true;
  id = result.pass === true ? ids[0] : undefined;
  report(result);
}

if (selected.has('detail')) {
  if (!id) report({ case: 'detail', pass: false, failure: 'NO_SERVER_ID' });
  else {
    const { body, result } = await request('detail', `/api/server?id=${encodeURIComponent(id)}`);
    result.shape_valid = isRecord(body) && body.id === id && isRecord(body.sysConfig);
    result.pass = result.pass === true && result.shape_valid === true;
    report(result);
  }
}

for (const [label, hours] of [['history-1h', 1], ['history-7d', 168]] as const) {
  if (!selected.has(label)) continue;
  if (!id) { report({ case: label, pass: false, failure: 'NO_SERVER_ID' }); continue; }
  const { body, result } = await request(label, `/api/history/all?id=${encodeURIComponent(id)}&hours=${hours}`, 110_000);
  const rows = Array.isArray(body) ? body : [];
  const times = rows.flatMap(row => isRecord(row) && typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) ? [row.timestamp] : []);
  const unique = new Set(times).size === times.length;
  const sorted = times.every((t, i) => i === 0 || t > times[i - 1]!);
  const span = times.length > 1 ? (times.at(-1)! - times[0]!) / 3_600_000 : 0;
  result.row_count = rows.length;
  result.span_hours = Math.round(span * 1_000_000) / 1_000_000;
  result.timestamp_order_valid = sorted && unique;
  result.shape_valid = Array.isArray(body) && times.length === rows.length && sorted && unique && span <= hours;
  result.system_rows_with_samples = rows.filter(row => isRecord(row) && ['cpu', 'ram_used', 'disk_used', 'net_in_speed'].some(key => typeof row[key] === 'number')).length;
  result.has_system_samples = Number(result.system_rows_with_samples) > 0;
  result.ping_rows_with_samples = rows.filter(row => isRecord(row) && Object.entries(row).some(([key, value]) => key.startsWith('ping_') && typeof value === 'number')).length;
  result.has_ping_samples = Number(result.ping_rows_with_samples) > 0;
  result.pass = result.pass === true && result.shape_valid === true && rows.length > 0 && result.has_system_samples === true;
  report(result);
}

// Compare measured values only: timestamps and inferred boot_time change even
// when the underlying metrics do not, so they cannot prove a live update.
const metricKeys = ['online', 'cpu', 'ram_used', 'ram_total', 'disk_used', 'disk_total', 'net_in_speed', 'net_out_speed', 'tcp_conn', 'udp_conn'];
function metricDigest(message: Record<string, unknown>): string {
  const samples: unknown[] = [];
  for (const update of Array.isArray(message.updates) ? message.updates : []) {
    if (!isRecord(update)) continue;
    for (const sample of Array.isArray(update.samples) ? update.samples : []) {
      if (!isRecord(sample) || !isRecord(sample.data)) continue;
      const data = sample.data;
      samples.push([update.serverId, Object.fromEntries(Object.keys(data).filter(key => metricKeys.includes(key) || key.startsWith('ping_') || key.startsWith('loss_')).sort().map(key => [key, data[key]]))]);
    }
  }
  return createHash('sha256').update(JSON.stringify(samples)).digest('hex');
}

async function verifyWebSocket(serverId: string): Promise<Record<string, unknown>> {
  const start = Date.now();
  const url = new URL('/api/ws', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  url.hostname='127.0.0.1';
  const transports = { websocket: 0, poll: 0, unknown: 0 };
  const result: Record<string, unknown> = { case: 'ws', status: null, frame_count: 0, batch_count: 0, batch_transport_counts: transports, downstream_messages_passed: false, upstream_native_ws_observed: false, upstream_native_ws_continuity_passed: false, measured_content_changed: false, pass: false };
  const writes: Promise<void>[] = [];
  return new Promise(resolveResult => {
    let finished = false, closing = false, batches = 0, firstDigest: string | undefined;
    const options: WebSocket.ClientOptions & { servername: string } = {
      headers: { ...headers, Host: base.host, Origin: base.origin },
      servername: base.hostname,
      handshakeTimeout: 10_000,
      followRedirects: false,
      maxPayload: 12_000_000,
    };
    const ws = new WebSocket(url, options);
    const end = async () => {
      if (finished) return; finished = true; clearTimeout(timer); clearTimeout(cleanupTimer);
      result.seconds = (Date.now() - start) / 1000;
      await Promise.all(writes);
      resolveResult(result);
    };
    const timer = setTimeout(() => {
      result.observation_limit_reached = true;
      if (result.downstream_messages_passed !== true) result.failure = 'OBSERVATION_TIMEOUT';
      ws.terminate(); void end();
    }, 90_000);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    ws.on('upgrade', response => { result.status = response.statusCode; });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: [serverId] })));
    ws.on('message', data => {
      if (finished) return;
      const index = Number(result.frame_count); result.frame_count = index + 1;
      writes.push(writeFile(resolve(output, `ws-frame-${index}.raw`), data.toString(), { mode: 0o600 }));
      let parsed: unknown;
      try { parsed = JSON.parse(data.toString()); } catch { result.invalid_json = true; return; }
      if (!isRecord(parsed)) return;
      if (parsed.type === 'bridgeStatus' && (parsed.status === 'unavailable' || parsed.status === 'stale')) result.degraded_status_seen = true;
      if (parsed.type !== 'batchUpdate') return;
      const valid = Array.isArray(parsed.updates) && parsed.updates.length > 0 && parsed.updates.every(update => isRecord(update) && update.serverId === serverId && Array.isArray(update.samples) && update.samples.length > 0 && update.samples.every(sample => isRecord(sample) && typeof sample.ts === 'number' && isRecord(sample.data)));
      if (!valid) { result.invalid_batch = true; return; }
      batches++; result.batch_count = batches;
      const transport = parsed.transport === 'websocket' || parsed.transport === 'poll' ? parsed.transport : 'unknown';
      transports[transport]++;
      result.upstream_native_ws_observed = transports.websocket > 0;
      result.upstream_native_ws_continuity_passed = transports.websocket >= 2;
      const digest = metricDigest(parsed);
      if (!firstDigest) firstDigest = digest;
      else if (firstDigest !== digest) result.measured_content_changed = true;
      if (batches >= 2) {
        result.downstream_messages_passed = result.invalid_json !== true && result.invalid_batch !== true && transports.unknown === 0;
        result.pass = result.downstream_messages_passed;
      }
      // Keep the bounded observation open for native continuity and an actual
      // metric change. Unchanged values remain valid but are reported separately.
      if (transports.websocket >= 2 && result.measured_content_changed === true && !closing) {
        closing = true;
        ws.close(1000, 'acceptance complete');
        cleanupTimer = setTimeout(() => { ws.terminate(); void end(); }, 2_000);
      }
    });
    ws.on('error', () => { result.failure = 'WEBSOCKET_ERROR'; });
    ws.on('close', code => { result.close_code = code; void end(); });
  });
}

if (selected.has('ws')) report(id ? await verifyWebSocket(id) : { case: 'ws', pass: false, failure: 'NO_SERVER_ID' });
const summary = { requested_cases: only, cases: records, all_requested_checks_passed: records.every(record => record.pass === true) };
await save('summary', summary);
await writeFile(resolve('work/private/bridge-acceptance/latest-summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ acceptance: 'complete', all_requested_checks_passed: summary.all_requested_checks_passed }));
if (!summary.all_requested_checks_passed) process.exitCode = 1;
