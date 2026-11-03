import { Inflate } from 'fflate';
import { tokenizer } from 'acorn';
import { fetchCatalog, fetchPublicBytes, fetchPublicJson, repositoryParts, validatePublicUrl, ThemePackageError, type CatalogEntry, type Ecosystem, type PublicFetcher } from './catalog.ts';
export { ThemePackageError } from './catalog.ts';
export interface ThemeFile { path: string; bytes: Uint8Array; contentType: string; }
export interface LicenseRecord { spdx: string; text: string; source: string; sha256: string; status?: 'found' | 'missing'; documents?: {path:string;text:string;sha256:string}[]; }
/** Optional independent evidence must belong to this repository and be pinned. */
export interface LicenseEvidence { url: string; sha256: string; }
export interface InstallOptions { fetcher?: PublicFetcher; licenseEvidence?: LicenseEvidence; expectedCatalogRevision?: string; expectedBuildRevision?: string; }
/** Manually audited exact build → source-tag license, never a repository-wide default. */
export const AUDITED_LICENSE_EVIDENCE: Readonly<Record<string, LicenseEvidence>> = Object.freeze({
  'tokinx/cf-server-monitor-theme-emerald@0939eb9d6e7638ea301f9dd18a218eedba2420c2': {
    // Build commit says v1.2.10; that tag resolves to c80591198df4d2a0332b86b41e53e42fd341ed99.
    url: 'https://raw.githubusercontent.com/Tokinx/cf-server-monitor-theme-emerald/c80591198df4d2a0332b86b41e53e42fd341ed99/LICENSE',
    sha256: '3c9bd83dabc27cbe9870736c79deb8343c52f021c4acbca5d5156395854c1065',
  },
});
export interface ThemePackage {
  id: string; digest: string; themeId: string; name: string; ecosystem: Ecosystem;
  source: string; catalogSource: string; catalogRevision: string; pinnedVersion: string;
  license: LicenseRecord; entry: 'index.html'; files: ThemeFile[];
  compatibility: 'unverified'; configuration?: Record<string, unknown>;
  audit: { staticReferencesChecked: true; dynamicReferencesRequireBrowser: true; notices: string[] };
}
export const PACKAGE_LIMITS = Object.freeze({ archive: 16_000_000, total: 32_000_000, file: 8_000_000, files: 1200, ratio: 200 });
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string, message: string): never { throw new ThemePackageError(code, message); }
export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function safePackagePath(path: string, directory = false): string {
  const normalized = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (!normalized || normalized.length > 400 || normalized.startsWith('/') || /[\\:%?#\x00-\x1f\x7f]/.test(normalized) || normalized.normalize('NFC') !== normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) fail('PACKAGE_PATH', '主题包包含不安全或歧义路径。');
  return normalized;
}
const MIME: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
export function contentType(path: string): string | null {
  if (/^(LICENSE|LICENCE|COPYING|NOTICE|THIRD_PARTY)(\.[A-Za-z]+)?$/i.test(path.split('/').at(-1)!)) return 'text/plain; charset=utf-8';
  return MIME[path.split('.').at(-1)!.toLowerCase()] || null;
}
interface ZipMember { name: string; size: number; compressed: number; crc: number; directory: boolean; method: number; start: number; }
/** Inspect central AND local headers before any allocation/decompression. No ZIP64. */
function inspectZip(bytes: Uint8Array): ZipMember[] {
  if (bytes.length > PACKAGE_LIMITS.archive || bytes.length < 22) fail('ZIP_SIZE', 'ZIP大小无效或超过限制。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { eocd = pos; break; }
  if (eocd < 0) fail('ZIP_FORMAT', 'ZIP尾部目录无效。');
  const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), central = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || count !== view.getUint16(eocd + 8, true) || count > PACKAGE_LIMITS.files || count === 65535 || central + centralSize !== eocd) fail('ZIP_FORMAT', '不支持多卷、ZIP64或过多文件的主题包。');
  const members: ZipMember[] = [], names = new Set<string>(), ranges: [number, number][] = [];
  let offset = central, total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) fail('ZIP_FORMAT', 'ZIP中央目录损坏。');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const mode = view.getUint32(offset + 38, true) >>> 16, local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + commentLength > eocd || flags & 1 || ![0, 8].includes(method) || view.getUint16(offset + 34, true)) fail('ZIP_FORMAT', 'ZIP含加密或不支持的条目。');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name: string; try { name = decoder.decode(rawName); } catch { return fail('ZIP_PATH_ENCODING', 'ZIP路径必须为有效UTF-8。'); }
    const directory = name.endsWith('/'); safePackagePath(name, directory);
    const type = mode & 0xf000;
    if (type && type !== 0x8000 && type !== 0x4000) fail('ZIP_SPECIAL_FILE', '主题包禁止符号链接及特殊文件。');
    if (type === 0x4000 && !directory || type === 0x8000 && directory) fail('ZIP_SPECIAL_FILE', 'ZIP目录类型不一致。');
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) fail('ZIP_DUPLICATE', 'ZIP含重复或大小写冲突路径。'); names.add(key);
    if (method === 0 && size !== compressed) fail('ZIP_HEADER_MISMATCH', 'ZIP存储文件大小不一致。');
    if (size > PACKAGE_LIMITS.file || size > Math.max(1, compressed) * PACKAGE_LIMITS.ratio || (directory && size !== 0)) fail('ZIP_EXPANSION', 'ZIP单文件或压缩比超过限制。');
    total += size; if (total > PACKAGE_LIMITS.total) fail('ZIP_EXPANSION', 'ZIP展开总量超过限制。');
    if (local + 30 > central || view.getUint32(local, true) !== 0x04034b50) fail('ZIP_FORMAT', 'ZIP本地目录无效。');
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtra;
    if (start + compressed > central || localNameLength !== nameLength || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags || rawName.some((v, n) => v !== bytes[local + 30 + n])) fail('ZIP_HEADER_MISMATCH', 'ZIP本地与中央目录不一致。');
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size)) fail('ZIP_HEADER_MISMATCH', 'ZIP大小或校验信息不一致。');
    ranges.push([local, start + compressed]); members.push({ name, size, compressed, crc, directory, method, start });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== eocd) fail('ZIP_FORMAT', 'ZIP中央目录长度不一致。');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i > 0 && r[0] < ranges[i - 1]![1])) fail('ZIP_OVERLAP', 'ZIP条目相互覆盖。');
  return members;
}
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
export function readStaticZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const members = inspectZip(bytes), files = new Map<string, Uint8Array>();
  for (const member of members) {
    let body: Uint8Array;
    if (member.method === 0) body = bytes.slice(member.start, member.start + member.compressed);
    else {
      // Stream small compressed chunks; stop if actual expansion exceeds the
      // preflight size. A forged tiny size cannot hide an unbounded inflate.
      body = new Uint8Array(member.size); let produced = 0;
      try {
        const inflater = new Inflate(chunk => {
          produced += chunk.length;
          if (produced > member.size) fail('ZIP_EXPANSION', 'ZIP实际展开量超过声明大小。');
          body.set(chunk, produced - chunk.length);
        });
        for (let at = 0; at < member.compressed; at += 1024) {
          const end = Math.min(member.compressed, at + 1024);
          inflater.push(bytes.subarray(member.start + at, member.start + end), end === member.compressed);
        }
        if (produced !== member.size) fail('ZIP_CHECKSUM', 'ZIP实际文件大小不匹配。');
      } catch (error) { if (error instanceof ThemePackageError) throw error; return fail('ZIP_DECOMPRESSION', 'ZIP解压校验失败。'); }
    }
    if (body.length !== member.size || crc32(body) !== member.crc) fail('ZIP_CHECKSUM', 'ZIP文件大小或CRC校验失败。');
    if (!member.directory) files.set(member.name, body);
  }
  return files;
}
function recognizeLicense(text: string): string | null {
  if (/Permission is hereby granted, free of charge/i.test(text) && /THE SOFTWARE IS PROVIDED ["“]AS IS/i.test(text) && /copyright notice and this permission notice/i.test(text)) return 'MIT';
  if (/Apache License\s+Version 2\.0/i.test(text) && /END OF TERMS AND CONDITIONS/.test(text)) return 'Apache-2.0';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(text) && /THE SOFTWARE IS PROVIDED ["“]AS IS/i.test(text)) return 'ISC';
  return null;
}
async function licenseRecord(bytes: Uint8Array, source: string): Promise<LicenseRecord> {
  const text = new TextDecoder().decode(bytes); // Display unrecognized encodings with replacement characters; original bytes remain in the package.
  const spdx = recognizeLicense(text) ?? 'NOASSERTION';
  return { spdx, text, source, sha256: await sha256(bytes), status: text.trim() ? 'found' : 'missing' };
}
async function independentLicense(entry: CatalogEntry, evidence: LicenseEvidence | undefined, fetcher?: PublicFetcher): Promise<LicenseRecord> {
  if (!evidence) return {spdx:'NOASSERTION',text:'',source:'',sha256:await sha256(new Uint8Array()),status:'missing'};
  const repo = repositoryParts(entry.repositoryUrl), url = validatePublicUrl(evidence.url);
  if (!repo || url.search || url.hostname !== 'raw.githubusercontent.com' || !url.pathname.startsWith(`/${repo.owner}/${repo.repo}/`) || !new RegExp(`^/${repo.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${repo.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-f0-9]{40}/`).test(url.pathname) || !/^[a-f0-9]{64}$/.test(evidence.sha256)) fail('LICENSE_EVIDENCE', '独立许可证证据必须来自同仓库固定提交及明确摘要。');
  const bytes = await fetchPublicBytes(url.href, { fetcher, maxBytes: 100_000 });
  if (await sha256(bytes) !== evidence.sha256) fail('LICENSE_HASH', '独立许可证摘要不匹配。');
  return licenseRecord(bytes, url.href);
}
function manifest(bytes: Uint8Array | undefined, entry: CatalogEntry): Record<string, unknown> {
  let raw: unknown; try { raw = bytes && JSON.parse(decoder.decode(bytes)); } catch { return fail('MANIFEST_JSON', 'Komari主题清单无效。'); }
  if (!record(raw) || raw.short !== entry.id || raw.version !== entry.version) fail('MANIFEST_IDENTITY', 'Komari清单标识或版本与目录不一致。');
  if (raw.configuration !== undefined) {
    if (!record(raw.configuration) || (raw.configuration.type !== undefined && raw.configuration.type !== 'managed')) fail('MANIFEST_CONFIGURATION', '主题raw/redirect配置不允许进入可信管理页面。');
    if (JSON.stringify(raw.configuration).length > 100_000) fail('MANIFEST_CONFIGURATION', '主题配置清单过大。');
  }
  return raw;
}
function file(path: string, bytes: Uint8Array): ThemeFile {
  safePackagePath(path);
  const type = contentType(path); if (!type) fail('PACKAGE_FILE_TYPE', '主题包包含不受支持的文件类型。');
  if (bytes.length > PACKAGE_LIMITS.file) fail('PACKAGE_SIZE', '主题文件超过限制。');
  return { path, bytes, contentType: type };
}
function resolveReference(base: string, reference: string): string | null {
  if (!reference || reference.startsWith('#') || reference.startsWith('data:')) return null;
  if (/^(?:https?:)?\/\//i.test(reference)) fail('EXTERNAL_ASSET', '主题依赖外部静态资源，当前仅支持包内静态资源。');
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) fail('ASSET_PROTOCOL', '主题静态资源协议无效。');
  const cleaned = reference.split(/[?#]/, 1)[0]!;
  if (cleaned.includes('%') || cleaned.includes('\\')) fail('ASSET_PATH', '主题静态引用路径存在歧义。');
  const parts = (cleaned.startsWith('/') ? cleaned.slice(1) : base.split('/').slice(0, -1).concat(cleaned).join('/')).split('/');
  const normalized: string[] = [];
  for (const part of parts) { if (part === '.' || part === '') continue; if (part === '..') { if (!normalized.length) fail('ASSET_PATH', '主题静态引用越出包根目录。'); normalized.pop(); } else normalized.push(part); }
  return normalized.join('/');
}
/** Tokenize, never execute, JS. Streaming tokens avoid an unbounded AST allocation. */
function javascriptReferences(text: string): string[] {
  const refs: string[] = [];
  let mode = '', pending = '', previous = '';
  const tokens = tokenizer(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  try {
    for (const token of tokens) {
      const label = token.type.label, value = (token as typeof token & { value?: unknown }).value;
      if (mode === 'dynamicEnd') {
        if (label === ')' || label === ',') refs.push(pending);
        mode = ''; pending = '';
      } else if (mode === 'dynamicStart') {
        if (label === 'string') { pending = String(value); mode = 'dynamicEnd'; } else mode = '';
      } else if (mode === 'afterImport') {
        if (label === 'string') { refs.push(String(value)); mode = ''; }
        else if (label === '(') mode = 'dynamicStart';
        else if (label === '.') mode = '';
        else mode = 'clause';
      } else if (mode === 'afterExport') {
        mode = label === '*' || label === '{' ? 'clause' : '';
      } else if (mode === 'from') {
        if (label === 'string') { refs.push(String(value)); mode = ''; } else mode = 'clause';
      } else if (mode === 'clause') {
        if (label === ';') mode = '';
        else if (label === 'name' && value === 'from') mode = 'from';
      }
      if (label === 'import' && previous !== '.' && previous !== '?.') mode = 'afterImport';
      else if (label === 'export') mode = 'afterExport';
      if (label === 'string' && typeof value === 'string' && /^\/assets\/[^\s]+\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ttf|ico)$/.test(value)) refs.push(value);
      previous = label;
    }
  } catch { fail('ASSET_JAVASCRIPT', '主题JavaScript词法结构无效。'); }
  return refs;
}
/** Verify statically resolvable local resources. Dynamic JS still needs a browser. */
export function validateStaticReferences(files: ThemeFile[]): void {
  const paths = new Set(files.map(f => f.path));
  if (!paths.has('index.html')) fail('ENTRY_REQUIRED', '主题包缺少根index.html。');
  for (const asset of files) {
    if (!/\.(html|css|m?js)$/.test(asset.path)) continue;
    let text: string; try { text = decoder.decode(asset.bytes); } catch { return fail('ASSET_ENCODING', '主题文本资源编码无效。'); }
    const refs: string[] = [];
    if (asset.path.endsWith('.html')) {
      for (const tag of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:script|link|img|source|video|audio|iframe)\b[^>]*>/gi)) {
        if (/^<link/i.test(tag[0]) && !/rel\s*=\s*["'](?:stylesheet|modulepreload|preload|icon|shortcut icon|apple-touch-icon|manifest)["']/i.test(tag[0])) continue;
        for (const attr of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) refs.push(attr[1]!);
      }
    }
    if (asset.path.endsWith('.css')) {
      for (const match of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/g)) refs.push(match[1] || match[2]!);
    }
    if (/\.m?js$/.test(asset.path)) refs.push(...javascriptReferences(text));
    for (const ref of refs) { const path = resolveReference(asset.path, ref); if (path && !paths.has(path)) throw Object.assign(new ThemePackageError('ASSET_MISSING', '主题静态资源引用不完整。'), { assetPath: asset.path, referencePath: path }); }
  }
}
async function finish(entry: CatalogEntry, files: ThemeFile[], license: LicenseRecord, source: string, pinnedVersion: string, configuration?: Record<string, unknown>): Promise<ThemePackage> {
  if (files.length > PACKAGE_LIMITS.files || files.reduce((n, f) => n + f.bytes.length, 0) > PACKAGE_LIMITS.total) fail('PACKAGE_SIZE', '主题资产总量超过限制。');
  if (new Set(files.map(f => f.path.toLowerCase())).size !== files.length) fail('PACKAGE_DUPLICATE', '展示根目录含重复资产路径。');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  validateStaticReferences(files);
  license.documents = await Promise.all(files.filter(f => /(?:^|\/)(?:LICENSE|LICENCE|COPYING|NOTICE|THIRD_PARTY)(?:\.[^/]*)?$|(?:^|\/)licenses?\//i.test(f.path)).filter(f => f.contentType.startsWith('text/')).map(async f => ({path:f.path,text:new TextDecoder().decode(f.bytes),sha256:await sha256(f.bytes)})));
  const descriptor = JSON.stringify({ ecosystem: entry.ecosystem, themeId: entry.id, source, pinnedVersion, license: license.sha256, files: await Promise.all(files.map(async f => [f.path, f.contentType, await sha256(f.bytes)])) });
  const digest = await sha256(encoder.encode(descriptor));
  return { id: digest.slice(0, 32), digest, themeId: entry.id, name: entry.name, ecosystem: entry.ecosystem, source, catalogSource: entry.catalogSource, catalogRevision: entry.catalogRevision, pinnedVersion, license, entry: 'index.html', files, compatibility: 'unverified', ...(configuration ? { configuration } : {}), audit: { staticReferencesChecked: true, dynamicReferencesRequireBrowser: true, notices: files.filter(f => /(?:LICENSE|LICENCE|NOTICE|THIRD_PARTY)/i.test(f.path)).map(f => f.path) } };
}
export async function buildKomariPackage(entry: CatalogEntry, archive: Uint8Array, options: InstallOptions = {}): Promise<ThemePackage> {
  if (entry.ecosystem !== 'komari' || !entry.sha256 || await sha256(archive) !== entry.sha256) fail('PACKAGE_SHA256', '主题ZIP与固定目录摘要不一致。');
  const unpacked = readStaticZip(archive), config = manifest(unpacked.get('komari-theme.json'), entry);
  let license: LicenseRecord | undefined;
  for (const candidate of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE', 'LICENCE.md', 'COPYING', 'dist/LICENSE', 'dist/LICENSE.txt', 'dist/LICENSE.md', 'dist/COPYING']) if (unpacked.has(candidate)) { license = await licenseRecord(unpacked.get(candidate)!, `${entry.downloadUrl}#${candidate}`); break; }
  license ??= await independentLicense(entry, options.licenseEvidence, options.fetcher);
  const files: ThemeFile[] = [];
  for (const [path, bytes] of unpacked) {
    if (path.startsWith('dist/')) files.push(file(path.slice(5), bytes));
    else if (/^(?:(?:LICENSE|LICENCE|COPYING|NOTICE|THIRD_PARTY)(?:\.[A-Za-z]+)?|licenses?\/.+)$/i.test(path)) files.push(file(path, bytes));
    else if (path !== 'komari-theme.json' && !/^(?:README(?:\.[A-Za-z]+)?|preview\.(?:png|webp|jpg|jpeg))$/i.test(path)) fail('PACKAGE_EXTRA_FILE', 'Komari包根目录包含非静态交付文件。');
  }
  if (license.text && !files.some(f => /^(?:LICENSE|LICENCE|COPYING)(?:\.[A-Za-z]+)?$/i.test(f.path))) files.push(file('LICENSE', encoder.encode(license.text)));
  return finish(entry, files, license, entry.downloadUrl!, `${entry.version}@sha256:${entry.sha256}`, record(config.configuration) ? config.configuration : undefined);
}
interface TreeBlob { path: string; sha: string; size: number; }
async function buildCfsmPackage(entry: CatalogEntry, options: InstallOptions): Promise<ThemePackage> {
  const repo = repositoryParts(entry.repositoryUrl); if (!repo || !entry.branch) fail('CFSM_SOURCE', 'CFSM构建来源无效。');
  const api = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  if (options.expectedBuildRevision !== undefined && !/^[a-f0-9]{40}$/.test(options.expectedBuildRevision)) fail('CFSM_COMMIT', '固定构建版本无效。');
  const commit = options.expectedBuildRevision ? {sha:options.expectedBuildRevision} : await fetchPublicJson(`${api}/commits/${encodeURIComponent(entry.branch)}`, { fetcher: options.fetcher });
  if (!record(commit) || typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha)) fail('CFSM_COMMIT', '无法将构建分支固定为Git提交。');
  const sha = commit.sha;
  const tree = await fetchPublicJson(`${api}/git/trees/${sha}?recursive=1`, { fetcher: options.fetcher, maxBytes: 4_000_000 });
  if (!record(tree) || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 10000) fail('CFSM_TREE', '构建资源树不完整或过大。');
  const selected: TreeBlob[] = [];
  for (const node of tree.tree) {
    if (!record(node) || typeof node.path !== 'string') fail('CFSM_TREE', '构建资源树条目无效。');
    if (node.type !== 'blob') continue;
    const path = safePackagePath(node.path);
    if (!(!path.includes('/') || /^(?:assets|flags|os-icons|fonts|licenses)\//.test(path))) continue;
    if (!contentType(path)) continue;
    if (node.mode !== '100644' && node.mode !== '100755') fail('CFSM_SPECIAL_FILE', '构建资源中禁止符号链接。');
    if (typeof node.sha !== 'string' || !/^[a-f0-9]{40}$/.test(node.sha) || typeof node.size !== 'number' || node.size > PACKAGE_LIMITS.file || node.size < 0) fail('CFSM_TREE', '构建资源摘要或大小无效。');
    selected.push({ path, sha: node.sha, size: node.size });
  }
  if (selected.length > PACKAGE_LIMITS.files || selected.reduce((n, f) => n + f.size, 0) > PACKAGE_LIMITS.total || !selected.some(f => f.path === 'index.html')) fail('CFSM_BUILD_REQUIRED', '构建分支缺少预构建入口或超出资产配额；不会运行构建脚本。');
  const evidence = options.licenseEvidence ?? AUDITED_LICENSE_EVIDENCE[`${repo.owner}/${repo.repo}@${sha}`.toLowerCase()];
  const hasLicense = selected.some(f => /^(?:LICENSE|LICENCE|COPYING)(?:\.[A-Za-z]+)?$/i.test(f.path));
  const independent = hasLicense ? undefined : await independentLicense(entry, evidence, options.fetcher);
  const files: ThemeFile[] = [];
  // Sequential bounded downloads avoid thousands of parallel origin requests.
  for (const node of selected) {
    const bytes = await fetchPublicBytes(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${sha}/${node.path.split('/').map(encodeURIComponent).join('/')}`, { fetcher: options.fetcher, maxBytes: PACKAGE_LIMITS.file });
    if (bytes.length !== node.size) fail('CFSM_BLOB_SIZE', '构建资源长度与固定树不一致。');
    const prefix = encoder.encode(`blob ${bytes.length}\0`), input = new Uint8Array(prefix.length + bytes.length); input.set(prefix); input.set(bytes, prefix.length);
    const blobHash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', input))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (blobHash !== node.sha) fail('CFSM_BLOB_HASH', '构建资源与固定Git树摘要不一致。');
    files.push(file(node.path, bytes));
  }
  const candidate = files.find(f => /^(?:LICENSE|LICENCE|COPYING)(?:\.[A-Za-z]+)?$/i.test(f.path));
  const license = candidate ? await licenseRecord(candidate.bytes, `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${sha}/${candidate.path}`) : independent!;
  if (!candidate && license.text) files.push(file('LICENSE', encoder.encode(license.text)));
  return finish(entry, files, license, repo.url, sha);
}
/** Public installer entry: IDs only; authoritative URLs come from pinned catalogs. */
export async function installCatalogTheme(ecosystem: Ecosystem, themeId: string, options: InstallOptions = {}): Promise<ThemePackage> {
  const catalog = await fetchCatalog(ecosystem, options.fetcher, { revision: options.expectedCatalogRevision }), entry = catalog.entries.find(item => item.id === themeId);
  if (!entry) fail('THEME_NOT_FOUND', '主题不在已固定的官方目录中。');
  if (!entry.canAttemptInstall) fail('THEME_UNSUPPORTED', '该目录条目的来源或分发格式暂不受支持。');
  if (ecosystem === 'komari') {
    const archive = await fetchPublicBytes(entry.downloadUrl!, { fetcher: options.fetcher, maxBytes: PACKAGE_LIMITS.archive, timeoutMs: 60_000 });
    return buildKomariPackage(entry, archive, options);
  }
  return buildCfsmPackage(entry, options);
}
