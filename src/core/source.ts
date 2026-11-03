import { readConfig, type Config } from './config.ts';
import type { Binding } from './identity.ts';

/** Private server-side settings. Never include these in theme/public state. */
export interface SourceSettings {
  baseUrl:string; token:string; bindings:Binding[]; pingTargets:Config['pingTargets'];
}
export interface SavedSource extends SourceSettings {version:number;}
export interface SourceReview {
  id:string; expires:number; expectedVersion:number; settings:SourceSettings;
  candidates:{match:Binding['match']; newId:string; suggestedId:string}[];
  previous:Binding[]; targets:{key:string;label:string}[];
}
export function sourceConfig(base:Config,source:SourceSettings):Config {
  const checked=readConfig({MMWX_BASE_URL:source.baseUrl,MMWX_PROBE_TOKEN:source.token,BRIDGE_BINDINGS:JSON.stringify(source.bindings),BRIDGE_PING_TARGETS:JSON.stringify(source.pingTargets)});
  return {...base,baseUrl:checked.baseUrl,token:checked.token,bindings:checked.bindings,pingTargets:checked.pingTargets};
}
