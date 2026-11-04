/** Developer-only packager. Produces a self-contained host-platform archive, never publishes. */
import { cp, mkdir, mkdtemp, readFile, writeFile, realpath, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
type Package = { name: string; version: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>; bundleDependencies?: string[]; bundledDependencies?: string[] };
async function installed(name: string, from: string) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name === '.' || name === '..') throw new Error('Invalid dependency name.');
  for (let dir = from; ; dir = dirname(dir)) {
    try { return await realpath(join(dir, 'node_modules', name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dir === dirname(dir)) throw new Error(`Production dependency missing: ${name}`);
  }
}
async function copyDependency(name: string, from: string, target: string, ancestors: Set<string>, specifier?: string) {
  const source = await installed(name, from);
  if (ancestors.has(source)) throw new Error(`Dependency cycle requires packaging review: ${name}`);
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as Package;
  const alias=/^npm:((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@/i.exec(specifier??'')?.[1];
  if (pkg.name !== (alias??name)) throw new Error(`Dependency identity mismatch: ${name}`);
  const destination = join(target, 'node_modules', name);
  // npm ships a complete bundled dependency tree. Preserve it instead of
  // expanding the same dependency graph into many duplicate nested copies.
  const bundled=new Set(pkg.bundleDependencies??pkg.bundledDependencies??[]);
  for(const child of bundled)await access(join(source,'node_modules',child,'package.json'));
  await cp(source, destination, {
    recursive: true, dereference: true,
    filter: path => {
      const parts=relative(source,path).split('/');
      // Bundled archives may flatten transitive packages beside direct ones.
      // Keep the whole package-owned tree, not just its declared entry names.
      return !parts.includes('node_modules')||(bundled.size>0&&parts[0]==='node_modules');
    },
  });
  const next = new Set([...ancestors, source]);
  const dependencies = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.optionalDependencies };
  for (const child of Object.keys(dependencies)) {
    if(bundled.has(child))continue;
    const optional = child in (pkg.optionalDependencies || {}) || pkg.peerDependenciesMeta?.[child]?.optional;
    if (optional) { try { await installed(child, source); } catch { continue; } }
    await copyDependency(child, source, destination, next, dependencies[child]);
  }
}

export async function packageLocal(nodeDirectory: string, outputDirectory: string, root = project) {
  const nodeDir = resolve(nodeDirectory), output = resolve(outputDirectory);
  if (!['linux', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Only Linux/macOS x64/arm64 build hosts are supported.');
  const runtime = JSON.parse((await exec(join(nodeDir, 'bin/node'), ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'])).stdout) as { version: string; platform: string; arch: string };
  if (Number(runtime.version.split('.')[0]) < 24 || runtime.platform !== process.platform || runtime.arch !== process.arch) throw new Error('Provide an official Node 24+ distribution matching the build host OS and architecture.');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Package;
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
  for (const path of ['dist/node.js', 'dist/local-service.js', 'dist/bundled/index.json', 'dist/bundled/_management/index.html', 'LICENSE', 'deploy/local/leobridge.sh']) await access(join(root, path));
  await access(join(nodeDir, 'LICENSE'));
  await mkdir(output, { recursive: true });
  const name = `leobridge-${pkg.version}-${runtime.platform}-${runtime.arch}`;
  const archive = join(output, name + '.tar.gz');
  for (const file of [archive, archive + '.sha256']) {
    try { await access(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error(`Refusing to overwrite ${file}`);
  }
  const temp = await mkdtemp(join(output, '.package-'));
  const bundle = join(temp, name);
  try {
    await mkdir(join(bundle, 'runtime/bin'), { recursive: true });
    for (const file of ['dist/node.js', 'dist/local-service.js', 'dist/bundled', 'LICENSE']) await cp(join(root, file), join(bundle, file), { recursive: true });
    await cp(join(root, 'deploy/local/leobridge.sh'), join(bundle, 'leobridge.sh'));
    await cp(join(nodeDir, 'bin/node'), join(bundle, 'runtime/bin/node'), { dereference: true });
    await cp(join(nodeDir, 'LICENSE'), join(bundle, 'runtime/LICENSE'));
    await mkdir(join(bundle, 'node_modules'), { recursive: true });
    for (const name of Object.keys(pkg.dependencies || {})) await copyDependency(name, root, bundle, new Set(), pkg.dependencies![name]);
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', private: true }) + '\n');
    await writeFile(join(bundle, 'release.json'), JSON.stringify({ version: pkg.version, node: runtime.version, platform: runtime.platform, arch: runtime.arch }, null, 2) + '\n');
    await writeFile(join(bundle, 'README.txt'), `LeoBridge ${pkg.version} (${runtime.platform}/${runtime.arch})

Start:   ./leobridge.sh start
Stop:    ./leobridge.sh stop
Restart: ./leobridge.sh restart
Status:  ./leobridge.sh status
Logs:    ./leobridge.sh logs
Quiet:   ./leobridge.sh start --quiet

The package includes Node and production dependencies. No startup build step.
Native themes are built on demand when prepared in the admin UI; npm and esbuild are included.
Default admin URL: http://127.0.0.1:8787/admin/
首次登录：全新状态且未自定义账号时使用admin/admin，默认密码须先修改。
已有实例使用当前已保存的密码。
默认仅本机访问，无需创建.dev.vars；主控地址和Token在后台检查并保存。

.dev.vars生效规则：
- BRIDGE_LISTEN_PORT、BRIDGE_ADMIN_USERNAME、BRIDGE_TITLE、BRIDGE_THEME_STORE等运行参数，
  修改后执行 ./leobridge.sh restart。环境变量优先于同名文件项。
- 管理密码和数据源只在后台设置，统一保存在state.json，立即生效且不回写.dev.vars。
- BRIDGE_THEME_STORE默认data；切换目录不迁移原数据，升级须保留原目录。
Older releases used work/theme-store. Move the full directory while stopped, or explicitly set BRIDGE_THEME_STORE to keep it.
Data: ./data (includes credentials). Logs and control state: work/local.
Stop before backing up or upgrading. Preserve all of data and your
private configuration; never copy work/local control state to another instance.
Start only one instance per data directory. No automatic restart or boot service.
Node's notices are in runtime/LICENSE; dependency licenses are in node_modules.
`);
    await exec('tar', ['-czf', join(temp, basename(archive)), '-C', temp, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const bytes = await readFile(join(temp, basename(archive)));
    await writeFile(archive, bytes, { flag: 'wx', mode: 0o644 });
    await writeFile(archive + '.sha256', `${createHash('sha256').update(bytes).digest('hex')}  ${basename(archive)}\n`, { flag: 'wx', mode: 0o644 });
    return archive;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--node-dir' || args[2] !== '--out-dir') {
    console.error('Usage: pnpm package:local --node-dir /path/to/verified-node-distribution --out-dir /path/to/output');
    process.exitCode = 2;
  } else packageLocal(args[1]!, args[3]!).then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
}
