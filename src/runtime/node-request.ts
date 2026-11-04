import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { Env } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';
import { managementConfig, installationFromUrl, type ManagementConfig } from '../management/config.ts';

export interface NodeRuntimeConfig {
  mode: 'local' | 'direct' | 'proxy';
  host: string;
  port: number;
  trustedProxies: BlockList;
}
const configuration = (message = 'Node监听或反向代理配置无效，请检查 BRIDGE_NODE_MODE、BRIDGE_LISTEN_HOST、BRIDGE_LISTEN_PORT 和 BRIDGE_TRUSTED_PROXIES。') => new BridgeError('NODE_CONFIGURATION', 503, message);
const badRequest = () => new BridgeError('BAD_REQUEST', 400, '请求地址或转发头无效。');
const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');
function listed(list: BlockList, address: string | undefined): boolean {
  const family = address && isIP(address);
  // BlockList also matches IPv4-mapped IPv6 peers against IPv4 CIDRs.
  return family === 4 || family === 6 ? list.check(address!, family === 4 ? 'ipv4' : 'ipv6') : false;
}
export function isLoopback(address: string | undefined): boolean { return listed(loopback, address); }
export function isTrustedProxy(runtime: NodeRuntimeConfig, address: string | undefined): boolean {
  return listed(runtime.trustedProxies, address);
}
function proxyOrigins(config: ManagementConfig) {
  for (const origin of [config.adminOrigin, config.displayOrigin, config.previewOrigin]) {
    let url: URL;
    try { url = new URL(origin); } catch { throw configuration(); }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw configuration('proxy 模式要求所有站点源使用 HTTPS；请检查 BRIDGE_ORIGIN 及独立管理/预览源。');
  }
}
export function readNodeRuntimeConfig(env: Env): NodeRuntimeConfig {
  const mode = env.BRIDGE_NODE_MODE ?? 'local';
  const management = managementConfig(env);
  const host = env.BRIDGE_LISTEN_HOST ?? '127.0.0.1';
  const siteUrl = new URL(management.displayOrigin);
  const portText = env.BRIDGE_LISTEN_PORT ?? env.PORT ?? (mode === 'proxy' || siteUrl.protocol === 'https:' ? '8787' : management.routing === 'single' ? siteUrl.port || '80' : '8787');
  if ((mode !== 'local' && mode !== 'proxy' && mode !== 'direct') || (host !== 'localhost' && !isIP(host))
    || (mode === 'local' && host !== 'localhost' && !isLoopback(host))
    || !/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw configuration();
  const trustedProxies = new BlockList();
  for (const item of (env.BRIDGE_TRUSTED_PROXIES ?? '127.0.0.1/32,::1/128').split(',')) {
    const [address, prefix, ...extra] = item.trim().split('/');
    const family = isIP(address!);
    if (!family || extra.length || (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) throw configuration();
    try {
      if (prefix === undefined) trustedProxies.addAddress(address!, family === 4 ? 'ipv4' : 'ipv6');
      else trustedProxies.addSubnet(address!, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
    } catch { throw configuration(); }
  }
  if (mode !== 'proxy' && [management.adminOrigin, management.displayOrigin, management.previewOrigin].some(origin => new URL(origin).protocol !== (management.routing === 'single' ? siteUrl.protocol : 'http:'))) {
    throw configuration('single 模式的站点源须使用一致协议；独立 HTTPS 多源请使用高级 proxy 模式。');
  }
  if (mode === 'direct' && (management.routing !== 'single' || !['public','private'].includes(env.BRIDGE_ACCESS || ''))) throw configuration('direct 模式要求 BRIDGE_ROUTING=single 且 BRIDGE_ACCESS=public 或 private。');
  if (mode === 'proxy') {
    if (env.BRIDGE_DEV_PROXY) throw configuration('proxy 模式不能使用 BRIDGE_DEV_PROXY；该变量仅用于开发出站代理。');
    proxyOrigins(management);
  }
  return { mode, host, port: Number(portText), trustedProxies };
}

function singleHeader(req: IncomingMessage, name: string, required = false): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1]!);
  }
  if (values.length > 1 || (required && values.length !== 1)) throw badRequest();
  return values[0];
}
function authority(value: string): void {
  const match = value.match(/^(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/);
  if (!match || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535))) throw badRequest();
  const host = match[1]!;
  if (host.startsWith('[')) {
    if (isIP(host.slice(1, -1)) !== 6) throw badRequest();
  } else if (/^[0-9.]+$/.test(host)) {
    if (isIP(host) !== 4) throw badRequest();
  } else if (host.length > 253 || host.split('.').some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) throw badRequest();
}

/** Shared by regular HTTP requests and WebSocket upgrade authorization. */
export function nodeRequest(req: IncomingMessage, runtime: NodeRuntimeConfig, management: ManagementConfig, body?: Buffer, localPort = runtime.port): Request {
  const target = req.url;
  if (!target || !target.startsWith('/') || target.startsWith('//') || /[\\\s#\u0000-\u001f\u007f]/.test(target)) throw badRequest();
  const host = singleHeader(req, 'host', true)!;
  authority(host);
  const peer = req.socket.remoteAddress;
  if (!peer || !isIP(peer)) throw badRequest();
  // This server always receives HTTP. In single-site mode the configured public
  // origin defines URL/cookie semantics; untrusted forwarding headers never do.
  let protocol = management.routing === 'single' ? new URL(management.displayOrigin).protocol : 'http:', client = peer;
  if (runtime.mode === 'proxy') {
    proxyOrigins(management);
    if (!isTrustedProxy(runtime, peer)) throw new BridgeError('UNTRUSTED_PROXY', 403, '请求未经过受信任的反向代理，请核对 BRIDGE_TRUSTED_PROXIES；实际连接来源见服务端日志。');
    if (singleHeader(req, 'x-forwarded-proto') !== 'https') throw new BridgeError('BAD_REQUEST', 400, '反向代理须覆盖 X-Forwarded-Proto 为单值 https。');
    protocol = 'https:';
    const realIp = singleHeader(req, 'x-real-ip');
    if (realIp !== undefined) {
      if (!isIP(realIp)) throw badRequest();
      client = realIp;
    }
  }
  let url: URL;
  try { url = new URL(`${protocol}//${host}${target}`); } catch { throw badRequest(); }
  if (runtime.mode === 'proxy' || runtime.mode === 'direct' || management.routing === 'single') {
    const origins = [management.adminOrigin, management.displayOrigin, management.previewOrigin];
    if (!origins.includes(url.origin) && !installationFromUrl(management, url)) throw new BridgeError('UNKNOWN_HOST', 421, '请求主机或端口与站点配置不匹配，请核对 BRIDGE_ORIGIN 及反向代理保留的 Host。');
  } else {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if ((hostname !== 'localhost' && !hostname.endsWith('.localhost') && !isLoopback(hostname))
      || Number(url.port || 80) !== localPort) throw badRequest();
  }
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      // These cannot influence downstream origin checks or login throttling.
      if (name === 'forwarded' || name.startsWith('x-forwarded-') || name === 'x-real-ip' || name === 'cf-connecting-ip' || name === 'host') continue;
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    headers.set('host', host);
    headers.set('cf-connecting-ip', client);
    return new Request(url, { method: req.method, headers, body: body as BodyInit | undefined });
  } catch { throw badRequest(); }
}
