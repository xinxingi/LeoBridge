/** Explicit local preparation; does not connect, deploy or overwrite credentials. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/core/config.ts';

process.umask(0o077);
const source = process.argv[2] ?? '.dev.vars';
const directory = resolve(process.argv[3] ?? 'work/private/ssh-test');
try {
  const env = parseEnv(await readFile(source, 'utf8')) as Record<string, string>;
  const config = readConfig(env);
  if (!config.token || !config.bindings.length) throw new Error('Incomplete source');
  // JSON strings can be safely single-quoted after escaping apostrophes in JSON.
  const jsonValue = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", '\\u0027')}'`;
  const literal = (value: string) => {
    for (const quote of ["'", '"', '`']) if (!value.includes(quote) && !/[\r\n]/.test(value)) return `${quote}${value}${quote}`;
    throw new Error('Unsupported dotenv value');
  };
  const password = randomBytes(24).toString('base64url');
  const content = [
    '# Private SSH test configuration. Do not commit or share.',
    `MMWX_BASE_URL=${literal(config.baseUrl)}`,
    `MMWX_PROBE_TOKEN=${literal(config.token)}`,
    `BRIDGE_BINDINGS=${jsonValue(config.bindings)}`,
    `BRIDGE_PING_TARGETS=${jsonValue(config.pingTargets)}`,
    'BRIDGE_TITLE=LeoBridge VPS Test',
    'BRIDGE_ADMIN_USERNAME=admin',
    `BRIDGE_ADMIN_PASSWORD=${password}`,
    '',
  ].join('\n');
  const parsed = parseEnv(content) as Record<string, string>;
  // Refuse a representation that would change a credential or identity value.
  if (parsed.MMWX_PROBE_TOKEN !== config.token || parsed.MMWX_BASE_URL !== config.baseUrl
    || JSON.stringify(JSON.parse(parsed.BRIDGE_BINDINGS!)) !== JSON.stringify(config.bindings)
    || JSON.stringify(JSON.parse(parsed.BRIDGE_PING_TARGETS!)) !== JSON.stringify(config.pingTargets)) throw new Error('Round-trip failed');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'runtime.env'), content, { flag: 'wx', mode: 0o600 });
  console.log(`Private configuration prepared in ${directory}/runtime.env. Existing files are never overwritten; no network requests were made.`);
} catch {
  console.error('SSH test preparation failed. Check the source configuration and use a new output directory; no secrets printed.');
  process.exitCode = 1;
}
