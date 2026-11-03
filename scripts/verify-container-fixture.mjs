// Synthetic source only. Mounted into an isolated test container by verify-container.mjs.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
let tick = 0;
const snapshot = () => ({ enabled: true, show_name: true, history_days: 7, servers: [
  { name: 'Synthetic online', online: true, cpu_pct: tick % 90, mem_used: 0, mem_total: 1024 ** 3, download_speed: tick * 1024, upload_speed: 0, ping: [{ key: 'target-a', current_ms: 0, loss_pct: 0 }] },
  { name: 'Synthetic offline', online: false, last_seen: '2026-11-02T00:00:00Z' },
  { name: 'Synthetic missing', online: true },
] });
const server = createServer((req, res) => {
  if (req.headers['x-mmwx-probe-token'] !== 'synthetic-container-token') { res.writeHead(401); res.end(); return; }
  const url = new URL(req.url, 'http://fixture');
  let data;
  if (url.pathname === '/api/public/probe-servers') data = snapshot();
  else if (url.pathname === '/api/public/probe-series') {
    const bucket_sec = { '1h': 300, '6h': 600, '24h': 1800, '7d': 7200 }[url.searchParams.get('range')];
    if (!bucket_sec) { res.writeHead(400); res.end(); return; }
    const generated_at = Math.floor(Date.now() / 1000), end = Math.floor(generated_at / bucket_sec) * bucket_sec;
    data = url.searchParams.get('metric') === 'ping'
      ? { success: true, generated_at, bucket_sec, all_series: [{ key: 'target-a', buckets: [0, 1, 2].map(i => ({ ms: i === 1 ? -1 : i * 10, loss: i === 1 ? -1 : 0 })) }] }
      : { success: true, generated_at, bucket_sec, series: { cpu_pct: [0, 1, 2].map(i => ({ t: end - (2 - i) * bucket_sec, value: i * 10 })) } };
  } else { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
});
const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, connection, head) => {
  if (req.url !== '/api/public/probe-ws' || req.headers['x-mmwx-probe-token'] !== 'synthetic-container-token') { connection.destroy(); return; }
  sockets.handleUpgrade(req, connection, head, ws => ws.send(JSON.stringify(snapshot())));
});
const timer = setInterval(() => { tick++; for (const ws of sockets.clients) if (ws.readyState === 1) ws.send(JSON.stringify(snapshot())); }, 300);
server.listen(8791, '0.0.0.0');
function close() { clearInterval(timer); for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.close(); }
process.once('SIGTERM', close); process.once('SIGINT', close);
