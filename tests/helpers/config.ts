import { readConfig as runtimeConfig, type Env } from '../../src/core/config.ts';
import { sourceConfig } from '../../src/core/source.ts';
export type { Config } from '../../src/core/config.ts';
/** Legacy-shaped synthetic fixtures only; production never reads source environment values. */
export function readConfig(env:Env,allowUnconfigured=false){
  const base=runtimeConfig(env);
  if(allowUnconfigured&&!env.MMWX_BASE_URL)return base;
  return sourceConfig(base,{baseUrl:env.MMWX_BASE_URL||'',token:env.MMWX_PROBE_TOKEN||'',bindings:JSON.parse(env.BRIDGE_BINDINGS||'[]'),pingTargets:JSON.parse(env.BRIDGE_PING_TARGETS||'{}')});
}
export { authorize } from '../../src/core/config.ts';
