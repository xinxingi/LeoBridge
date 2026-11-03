/** Reproducible, synthetic-only local workerd setup. Never reads repository
 * .dev.vars, imports the real Node runtime, starts workerd, or deploys anything.
 * Default: generate private fixture files without overwriting modified files.
 * --check: validate generated files and management assets (no bundled themes).
 * --serve-upstream: explicitly run only the synthetic upstream on 127.0.0.1:8791.
 */
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { WebSocketServer } from 'ws';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamPort = 8791, workerPort = 8795;
const syntheticToken = 'synthetic-token';
// Deliberately synthetic and local-only; matches the existing workerd fixture.
const syntheticPassword = 'Synthetic-worker-only-password-2026';
const { values } = parseArgs({ options: {
  check: { type: 'boolean', default: false },
  'serve-upstream': { type: 'boolean', default: false },
  directory: { type: 'string', default: 'work/private/worker-fixture' },
}, allowPositionals: false });
if (values.check && values['serve-upstream']) throw new Error('Choose --check or --serve-upstream, not both.');

function snapshot(tick: number) {
  return { enabled: true, show_name: true, history_days: 7, servers: [
    { name: 'Synthetic online', online: true, cpu_pct: tick % 25, mem_used: 0, mem_total: 1024 ** 3,
      disk_used: 1024 ** 3, disk_total: 10 * 1024 ** 3, download_speed: tick * 1024, upload_speed: 0,
      uptime: 3600, region_country: 'US', os: 'Debian', arch: 'amd64', cpu_threads: 2,
      loadavg: '0.00 0.00 0.00 1/50 100',
      ping: [{ key: 'target-a', label: 'Synthetic target', current_ms: tick % 2 ? 20 : 0, loss_pct: 0 }] },
    { name: 'Synthetic offline', online: false, last_seen: new Date().toISOString() },
    { name: 'Synthetic missing', online: true },
  ] };
}

async function serveUpstream() {
  let tick = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.headers['x-mmwx-probe-token'] !== syntheticToken) { response.writeHead(404); response.end(); return; }
    const url = new URL(request.url || '/', 'http://localhost');
    let body: unknown;
    if (url.pathname === '/api/public/probe-servers') body = snapshot(tick);
    else if (url.pathname === '/api/public/probe-series') {
      const bucket = ({ '1h': 300, '6h': 600, '24h': 1800, '7d': 7200 } as Record<string, number>)[url.searchParams.get('range') || '1h'];
      if (!bucket) { response.writeHead(400); response.end(); return; }
      const generated_at = Math.floor(Date.now() / 1000), last = Math.floor(generated_at / bucket) * bucket;
      const points = (value: number) => Array.from({ length: 10 }, (_, i) => ({ t: last - (9 - i) * bucket, value: value + i }));
      body = url.searchParams.get('metric') === 'ping'
        ? { success: true, bucket_sec: bucket, generated_at, all_series: [{ key: 'target-a', buckets: Array.from({ length: 10 }, (_, i) => ({ ms: i === 3 ? -1 : i * 10, loss: i === 3 ? -1 : 0 })) }] }
        : { success: true, bucket_sec: bucket, generated_at, series: { cpu_pct: points(0), mem_used: points(0), mem_total: points(1024 ** 3), download_speed: points(0), upload_speed: points(0) } };
    } else { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, connection, head) => {
    if (request.url !== '/api/public/probe-ws' || request.headers['x-mmwx-probe-token'] !== syntheticToken) { connection.destroy(); return; }
    sockets.handleUpgrade(request, connection, head, ws => ws.send(JSON.stringify(snapshot(tick))));
  });
  // Start the timer only after binding succeeds; EADDRINUSE does not leave a process running.
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(upstreamPort, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  const timer = setInterval(() => {
    tick++;
    for (const ws of sockets.clients) if (ws.readyState === 1) ws.send(JSON.stringify(snapshot(tick)));
  }, 5_000);
  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    clearInterval(timer);
    for (const ws of sockets.clients) ws.close(1000, 'synthetic fixture stopped');
    sockets.close(); server.close();
    const deadline = setTimeout(() => { for (const ws of sockets.clients) ws.terminate(); server.closeAllConnections(); }, 1_000);
    deadline.unref();
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  console.log(JSON.stringify({ fixture: 'synthetic-upstream-only', upstream_port: upstreamPort, spawned_node_bridge: false, reads_real_config: false }));
}

async function configure() {
  const privateRoot = resolve(root, 'work/private');
  const directory = resolve(root, values.directory!);
  if (!directory.startsWith(privateRoot + sep)) throw new Error('Fixture output must be a dedicated directory inside work/private.');
  if (!values.check) await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolvedPrivate = await realpath(privateRoot), resolvedDirectory = await realpath(directory);
  if (!resolvedDirectory.startsWith(resolvedPrivate + sep)) throw new Error('Fixture output must not escape work/private through a symlink.');
  const bundleRoot = resolve(root, 'dist/bundled');
  let bundles: unknown;
  try { bundles = JSON.parse(await readFile(resolve(bundleRoot, 'index.json'), 'utf8')); }
  catch { throw new Error('Build management assets first: pnpm build.'); }
  if (!Array.isArray(bundles) || bundles.length !== 0) throw new Error('Expected a theme-free product build; run pnpm build.');
  await readFile(resolve(bundleRoot, '_management/index.html'));
  const env: Record<string, string> = {
    MMWX_BASE_URL: `http://127.0.0.1:${upstreamPort}`, MMWX_PROBE_TOKEN: syntheticToken,
    BRIDGE_ACCESS: 'local', BRIDGE_TITLE: 'LeoBridge Synthetic Worker Fixture',
    BRIDGE_ADMIN_USERNAME: 'admin', BRIDGE_ADMIN_PASSWORD: syntheticPassword,
    BRIDGE_ADMIN_ORIGIN: `http://admin.worker.localhost:${workerPort}`,
    BRIDGE_DISPLAY_ORIGIN: `http://127.0.0.1:${workerPort}`, BRIDGE_DISPLAY_DOMAIN: 'display.worker.localhost',
    BRIDGE_PREVIEW_ORIGIN: `http://preview.worker.localhost:${workerPort}`,
    BRIDGE_BINDINGS: JSON.stringify(snapshot(0).servers.map((server, index) => ({ id: `synthetic-${index + 1}`, match: { name: server.name } }))),
    BRIDGE_PING_TARGETS: JSON.stringify({ ct: { key: 'target-a', label: 'Synthetic target' } }),
  };
  const note = '# Generated synthetic-only local fixture. Never deploy or use as real credentials.\n';
  const toml = `${note}name = "leobridge-worker-fixture"
main = ${JSON.stringify(resolve(root, 'src/runtime/worker.ts'))}
compatibility_date = "2025-10-11"
workers_dev = false

[assets]
directory = ${JSON.stringify(bundleRoot)}
binding = "ASSETS"
run_worker_first = true

[[r2_buckets]]
binding = "THEME_ASSETS"
bucket_name = "leobridge-fixture-assets"

[[durable_objects.bindings]]
name = "THEME_COORDINATOR"
class_name = "ThemeCoordinator"

[[migrations]]
tag = "theme-coordinator-v1"
new_sqlite_classes = ["ThemeCoordinator"]
`;
  const vars = note + Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n';
  const runtimeEnv = note + `BRIDGE_RUNTIME_PASSWORD='${syntheticPassword}'\n`;
  const expected: Record<string, string> = { 'wrangler.toml': toml, '.dev.vars': vars, 'runtime.env': runtimeEnv };
  let created = 0;
  // Preflight every existing file before writing any: never overwrite another fixture.
  for (const [name, contents] of Object.entries(expected)) {
    const path = resolve(directory, name);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Generated fixture files must be regular files.');
      if (await readFile(path, 'utf8') !== contents) throw new Error('Fixture files differ; choose a fresh --directory instead of overwriting them.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (values.check) throw new Error('Generate the isolated worker fixture before --check.'); }
  }
  if (!values.check) for (const [name, contents] of Object.entries(expected)) {
    try { await writeFile(resolve(directory, name), contents, { flag: 'wx', mode: 0o600 }); created++; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const parsed = parseEnv(await readFile(resolve(directory, '.dev.vars'), 'utf8')) as Record<string, string>;
  const runtime = parseEnv(await readFile(resolve(directory, 'runtime.env'), 'utf8')) as Record<string, string>;
  if (Object.keys(parsed).length !== Object.keys(env).length || Object.entries(env).some(([key, value]) => parsed[key] !== value) || runtime.BRIDGE_RUNTIME_PASSWORD !== syntheticPassword) throw new Error('Synthetic fixture round-trip validation failed.');
  console.log(JSON.stringify({ fixture: 'local-workerd-synthetic', check: 'passed', generated_files: created,
    directory: relative(root, directory), bundle_count: bundles.length, upstream_port: upstreamPort, worker_port: workerPort,
    reads_real_config: false, starts_services: false, deploys_resources: false }));
}

try { if (values['serve-upstream']) await serveUpstream(); else await configure(); }
catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') console.error('Synthetic upstream port 8791 is already in use; verify and reuse an existing synthetic fixture instead of starting another.');
  else console.error(error instanceof Error ? error.message : 'Synthetic fixture setup failed.');
  process.exitCode = 1;
}
