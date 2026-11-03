/** Public theme discovery only. This module never receives probe credentials. */
export type Ecosystem = 'cfsm' | 'komari' | 'native';
export type PublicFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class ThemePackageError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = 'ThemePackageError'; }
}
export const CATALOG_SOURCES = Object.freeze({
  native: { repository: 'mmwx-group/mmwx-probe', file: 'package.json', branch: 'main', id: 'mmwx-native', revision: '723427b18ea23a59a923a89155ebe1f3fa3fa824', url: 'https://github.com/mmwx-group/mmwx-probe/tree/723427b18ea23a59a923a89155ebe1f3fa3fa824', license: 'MSAL-1.0; original LICENSE is shown before installation' },
  cfsm: { repository: 'huilang-me/CFSM-Theme-Store', file: 'themes.json', branch: 'main', id: 'cfsm-official', revision: '6377a65414a2527bbab1e323348bf715dc51f116', url: 'https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/6377a65414a2527bbab1e323348bf715dc51f116/themes.json', license: 'MIT (catalog repository only)' },
  komari: { repository: 'komari-monitor/theme-market', file: 'v1.json', branch: 'main', id: 'komari-official', revision: '3f889543f6b839cb2452464e04306253f77791bd', url: 'https://raw.githubusercontent.com/komari-monitor/theme-market/3f889543f6b839cb2452464e04306253f77791bd/v1.json', license: 'No catalog LICENSE found at audited revision; theme licenses checked independently' },
});
export interface CatalogEntry {
  id: string; ecosystem: Ecosystem; sourceId: string; name: string; description: string;
  catalogRevision: string; catalogSource: string;
  repositoryUrl: string | null; branch?: string; version?: string; downloadUrl?: string; sha256?: string;
  canAttemptInstall: boolean; blockReasons: string[]; licenseStatus: 'unverified'; compatibility: 'unverified';
}
export interface Catalog {
  ecosystem: Ecosystem; source: string; sourceId: string; pinnedVersion: string; catalogRevision: string;
  catalogLicense: string; catalogLicenseRevision: string; fetchedAt: string; fromCache: boolean; entries: CatalogEntry[];
}
const HOSTS = new Set(['github.com', 'raw.githubusercontent.com', 'api.github.com', 'codeload.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export function validatePublicUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ThemePackageError('PUBLIC_URL', '主题来源地址无效。'); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw new ThemePackageError('PUBLIC_URL', '主题下载只允许已核实的公开GitHub来源。');
  return url;
}
export function repositoryParts(value: unknown): { owner: string; repo: string; url: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const url = validatePublicUrl(value);
    const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
    if (url.hostname !== 'github.com' || url.search || !match || ['.', '..'].includes(match[1]!) || ['.', '..'].includes(match[2]!)) return null;
    return { owner: match[1]!, repo: match[2]!, url: `https://github.com/${match[1]}/${match[2]}` };
  } catch { return null; }
}
export async function fetchPublicBytes(value: string, options: { fetcher?: PublicFetcher; maxBytes?: number; timeoutMs?: number } = {}): Promise<Uint8Array> {
  let url = validatePublicUrl(value);
  const fetcher = options.fetcher || fetch, maxBytes = options.maxBytes ?? 2_000_000;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 45_000);
  try {
    for (let hop = 0; hop <= 4; hop++) {
      const response = await fetcher(url, { redirect: 'manual', signal: abort.signal, headers: { Accept: 'application/octet-stream, application/json', 'User-Agent': 'LeoBridge-theme-installer' } });
      if (response.redirected) throw new ThemePackageError('UNVALIDATED_REDIRECT', '下载器绕过了逐跳地址校验。');
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === 4) throw new ThemePackageError('DOWNLOAD_REDIRECT', '主题下载重定向无效或过多。');
        url = validatePublicUrl(new URL(location, url));
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new ThemePackageError('DOWNLOAD_HTTP', `主题公开来源读取失败（HTTP ${response.status}）。`, 502), {httpStatus:response.status}); }
      if (response.url) validatePublicUrl(response.url);
      const length = Number(response.headers.get('content-length') || '0');
      if (length > maxBytes) { await response.body?.cancel(); throw new ThemePackageError('DOWNLOAD_SIZE', '主题下载超过大小限制。'); }
      if (!response.body) return new Uint8Array();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read(); if (done) break;
          total += chunk.byteLength;
          if (total > maxBytes) { await reader.cancel(); throw new ThemePackageError('DOWNLOAD_SIZE', '主题下载超过大小限制。'); }
          chunks.push(chunk);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    }
    throw new ThemePackageError('DOWNLOAD_REDIRECT', '主题下载重定向过多。');
  } catch (error) {
    if (error instanceof ThemePackageError) throw error;
    throw new ThemePackageError(abort.signal.aborted ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_UNAVAILABLE', '公开主题来源暂时无法读取。', 502);
  } finally { clearTimeout(timer); }
}
export async function fetchPublicJson(value: string, options: { fetcher?: PublicFetcher; maxBytes?: number; timeoutMs?: number } = {}): Promise<unknown> {
  const bytes = await fetchPublicBytes(value, options);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ThemePackageError('CATALOG_JSON', '公开来源未返回有效JSON。', 502); }
}
/** Resolve a branch to an immutable commit without depending on anonymous API quota. */
export async function repositoryRevision(repository:string,branch:string,fetcher?:PublicFetcher):Promise<string>{
  try{
    const value=await fetchPublicJson(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`,{fetcher,maxBytes:1_000_000});
    if(!record(value)||typeof value.sha!=='string'||! /^[a-f0-9]{40}$/.test(value.sha))throw new ThemePackageError('SOURCE_REVISION','上游分支未返回有效提交。',502);
    return value.sha;
  }catch(error){
    const status=(error as {httpStatus?:number}).httpStatus;
    if(status!==403&&status!==429&&!(status&&status>=500))throw error;
  }
  const html=new TextDecoder().decode(await fetchPublicBytes(`https://github.com/${repository}/tree/${encodeURIComponent(branch)}`,{fetcher,maxBytes:6_000_000}));
  for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!/data-target=["']react-app\.embeddedData["']/.test(script[1]!))continue;
    let root:unknown;try{root=JSON.parse(script[2]!);}catch{continue;}
    if(!record(root)||!record(root.payload))continue;
    const layout=root.payload.codeViewLayoutRoute,tree=root.payload.codeViewTreeRoute;
    if(!record(layout)||!record(layout.repo)||!record(tree)||!record(tree.refInfo))continue;
    const repo=layout.repo,ref=tree.refInfo;
    if(`${repo.ownerLogin}/${repo.name}`.toLowerCase()!==repository.toLowerCase()||ref.name!==branch||typeof ref.currentOid!=='string'||! /^[a-f0-9]{40}$/.test(ref.currentOid))continue;
    return ref.currentOid;
  }
  throw new ThemePackageError('SOURCE_REVISION','无法从上游仓库核实固定版本。',502);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
function localized(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 500);
  if (record(value)) for (const key of ['zh-CN', 'zh', 'en-US', 'en', ...Object.keys(value)]) if (typeof value[key] === 'string') return String(value[key]).slice(0, 500);
  return '';
}
function themes(raw: unknown): unknown[] {
  if (!record(raw) || raw.schema !== 1 || !Array.isArray(raw.themes) || raw.themes.length > 500) throw new ThemePackageError('CATALOG_SCHEMA', '主题目录格式或版本不受支持。', 502);
  return raw.themes;
}
function baseEntry(ecosystem: Ecosystem, id: unknown, name: string, description: string): CatalogEntry {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(id)) throw new ThemePackageError('CATALOG_ID', '主题目录包含无效标识。', 502);
  return { id, ecosystem, sourceId: CATALOG_SOURCES[ecosystem].id, catalogRevision: CATALOG_SOURCES[ecosystem].revision, catalogSource: CATALOG_SOURCES[ecosystem].url, name: name || id, description, repositoryUrl: null, canAttemptInstall: true, blockReasons: [], licenseStatus: 'unverified', compatibility: 'unverified' };
}
function unique(entries: CatalogEntry[]): CatalogEntry[] {
  if (new Set(entries.map(entry => entry.id.toLowerCase())).size !== entries.length) throw new ThemePackageError('CATALOG_DUPLICATE', '主题目录存在重复标识。', 502);
  return entries;
}
export function parseCfsmCatalog(raw: unknown): CatalogEntry[] {
  return unique(themes(raw).map(item => {
    if (!record(item)) throw new ThemePackageError('CATALOG_SCHEMA', 'CFSM目录条目无效。', 502);
    const entry = baseEntry('cfsm', item.id, string(item.title), string(item.description));
    entry.repositoryUrl = repositoryParts(item.url)?.url || null;
    entry.branch = typeof item.branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(item.branch) && !item.branch.includes('..') ? item.branch : undefined;
    if (!entry.repositoryUrl) entry.blockReasons.push('UNSUPPORTED_REPOSITORY');
    if (!entry.branch) entry.blockReasons.push('BUILD_BRANCH_REQUIRED');
    entry.canAttemptInstall = entry.blockReasons.length === 0;
    return entry;
  }));
}
export function parseKomariCatalog(raw: unknown): CatalogEntry[] {
  return unique(themes(raw).map(item => {
    if (!record(item)) throw new ThemePackageError('CATALOG_SCHEMA', 'Komari目录条目无效。', 502);
    const entry = baseEntry('komari', item.short, localized(item.name), localized(item.description));
    entry.repositoryUrl = repositoryParts(item.url)?.url || null;
    entry.version = string(item.version, 100);
    if (!entry.version) entry.blockReasons.push('VERSION_REQUIRED');
    if (typeof item.download === 'string') {
      try { entry.downloadUrl = validatePublicUrl(item.download).href; } catch { entry.blockReasons.push('UNSUPPORTED_DOWNLOAD_HOST'); }
    } else entry.blockReasons.push('DOWNLOAD_REQUIRED');
    if (typeof item.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(item.sha256)) entry.sha256 = item.sha256.toLowerCase();
    else entry.blockReasons.push('SHA256_REQUIRED');
    entry.canAttemptInstall = entry.blockReasons.length === 0;
    return entry;
  }));
}
export interface CatalogReadOptions {
  /** Resolve the official main branch with a short cache; never an arbitrary source. */
  latest?: boolean;
  /** Explicit refresh resolves main again, bypassing a previously cached result. */
  refresh?: boolean;
  /** Re-read an exact official repository revision, e.g. what the admin UI saw. */
  revision?: string;
}
export const CATALOG_CACHE_MS = 60_000;
interface CatalogCache { at?: number; value?: Catalog; pending?: Promise<Catalog>; }
// Keep independent runtimes/test fetchers isolated, and coalesce concurrent reads.
const latestCatalogs = new WeakMap<PublicFetcher, Map<Ecosystem, CatalogCache>>();
function validateRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value)) throw new ThemePackageError('CATALOG_REVISION', '目录版本必须为官方仓库的40位Git提交。');
  return value.toLowerCase();
}
async function catalogAtRevision(ecosystem: Ecosystem, revision: string, fetcher: PublicFetcher): Promise<Catalog> {
  const source = CATALOG_SOURCES[ecosystem];
  const url = `https://raw.githubusercontent.com/${source.repository}/${revision}/${source.file}`;
  if(ecosystem==='native'){
    if(revision!==source.revision)throw new ThemePackageError('NATIVE_REVISION','原生主题尚未核对该源码版本。');
    const entry={...baseEntry('native','mmwx-probe','妙妙屋 X 原生主题','沿用主控的 Pixel、Flat、Anime 或 Premium 外观；首次准备需下载并构建固定源码。'),repositoryUrl:'https://github.com/mmwx-group/mmwx-probe',version:revision};
    return {ecosystem,source:source.url,sourceId:source.id,pinnedVersion:revision,catalogRevision:revision,catalogLicense:source.license,catalogLicenseRevision:revision,fetchedAt:new Date().toISOString(),fromCache:false,entries:[entry]};
  }
  const raw = await fetchPublicJson(url, { fetcher, maxBytes: 2_000_000 });
  const entries = (ecosystem === 'cfsm' ? parseCfsmCatalog(raw) : parseKomariCatalog(raw)).map(entry => ({ ...entry, catalogRevision: revision, catalogSource: url }));
  return { ecosystem, source: url, sourceId: source.id, pinnedVersion: revision, catalogRevision: revision,
    catalogLicense: source.license, catalogLicenseRevision: source.revision,
    fetchedAt: new Date().toISOString(), fromCache: false, entries };
}
/** Two-argument callers retain the audited baseline. Management opts into latest. */
export async function fetchCatalog(ecosystem: Ecosystem, fetcher: PublicFetcher = fetch, options: CatalogReadOptions = {}): Promise<Catalog> {
  if (ecosystem !== 'cfsm' && ecosystem !== 'komari' && ecosystem !== 'native') throw new ThemePackageError('ECOSYSTEM', '未知主题生态。');
  if (!options || (options.latest !== undefined && typeof options.latest !== 'boolean') || (options.refresh !== undefined && typeof options.refresh !== 'boolean')) throw new ThemePackageError('CATALOG_OPTIONS', '目录读取选项无效。');
  if (options.revision !== undefined) {
    if (options.latest || options.refresh) throw new ThemePackageError('CATALOG_OPTIONS', '固定目录版本不能同时请求最新版本。');
    return catalogAtRevision(ecosystem, validateRevision(options.revision), fetcher);
  }
  const source = CATALOG_SOURCES[ecosystem];
  if (ecosystem==='native')return catalogAtRevision(ecosystem,source.revision,fetcher);
  if (!options.latest && !options.refresh) return catalogAtRevision(ecosystem, source.revision, fetcher);
  let scoped = latestCatalogs.get(fetcher);
  if (!scoped) { scoped = new Map(); latestCatalogs.set(fetcher, scoped); }
  let cached = scoped.get(ecosystem);
  if (!cached) { cached = {}; scoped.set(ecosystem, cached); }
  if (cached.pending) return structuredClone(await cached.pending);
  if (!options.refresh && cached.value && Date.now() - cached.at! < CATALOG_CACHE_MS) return { ...structuredClone(cached.value), fromCache: true };
  // A failed explicit refresh must not masquerade as a newly fetched old catalog.
  if (options.refresh) { cached.value = undefined; cached.at = undefined; }
  const task = (async () => {
    const revision = await repositoryRevision(source.repository, source.branch, fetcher);
    return catalogAtRevision(ecosystem, revision, fetcher);
  })();
  cached.pending = task;
  try { const catalog = await task; cached.value = catalog; cached.at = Date.now(); return structuredClone(catalog); }
  finally { if (cached.pending === task) cached.pending = undefined; }
}
