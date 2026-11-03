import { BridgeError } from './errors.ts';
import type { Binding } from './identity.ts';
export type Env = Record<string, string | undefined>;
export const PING_SLOTS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'] as const;
export type PingSlot = typeof PING_SLOTS[number];
export interface Config {
  baseUrl: string; token: string; access: 'local' | 'public' | 'private';
  username: string; password: string; title: string; bindings: Binding[];
  pingTargets: Partial<Record<PingSlot, {key:string;label:string}>>;
  timeoutMs: number; cacheMs: number; staleMs: number;
}
export function readConfig(env: Env): Config {
  const access = env.BRIDGE_ACCESS || 'local';
  if (!['local', 'public', 'private'].includes(access)) throw new BridgeError('CONFIGURATION', 503, '无效访问策略。');
  if (access === 'private' && (!env.BRIDGE_USERNAME || (env.BRIDGE_PASSWORD || '').length < 16)) {
    throw new BridgeError('CONFIGURATION', 503, '私有站点需配置用户名及至少16字符的独立密码。');
  }
  return {
    baseUrl:'', token:'', access:access as Config['access'],
    username:env.BRIDGE_USERNAME || '', password:env.BRIDGE_PASSWORD || '',
    title:env.BRIDGE_TITLE || 'LeoBridge', bindings:[], pingTargets:{},
    timeoutMs:30000, cacheMs:3000, staleMs:45000,
  };
}
export function authorize(request: Request, config: Config): Response | null {
  const url = new URL(request.url);
  if (config.access === 'local' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname) && !url.hostname.endsWith('.localhost')) {
    return new Response('请明确配置 BRIDGE_ACCESS=public 或 private。', {status:403});
  }
  if (config.access === 'private') {
    let actual = '';
    try {
      const header=request.headers.get('authorization')||'';
      if(!header.startsWith('Basic '))throw new Error();
      const bytes=Uint8Array.from(atob(header.slice(6)),character=>character.charCodeAt(0));
      actual=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    } catch { /* denied */ }
    const expected = `${config.username}:${config.password}`;
    let difference = actual.length ^ expected.length;
    for (let i=0;i<Math.max(actual.length,expected.length);i++) difference |= (actual.charCodeAt(i)||0) ^ (expected.charCodeAt(i)||0);
    if (difference) return new Response('Private LeoBridge', {status:401, headers:{'WWW-Authenticate':'Basic realm="LeoBridge", charset="UTF-8"','Cache-Control':'no-store'}});
  }
  return null;
}
