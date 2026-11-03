import type { Config } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';
import { normalizeSnapshot, type Snapshot } from '../core/model.ts';
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export class Upstream {
  private cached?: Snapshot;
  private inflight?: Promise<Snapshot>;
  private revision=0;
  constructor(readonly config: Config, private fetcher: Fetcher = (input,init)=>fetch(input,init), private now = Date.now) {}
  async json(path: '/api/public/probe-servers' | '/api/public/probe-series', params?: Record<string,string>): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl);
    for (const [key,value] of Object.entries(params || {})) url.searchParams.set(key,value);
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try {
      let response:Response;
      for(let attempt=0;;attempt++) {
        try {
          response=await this.fetcher(url,{headers:{'X-MMwx-Probe-Token':this.config.token,Accept:'application/json'},signal:controller.signal,redirect:'manual'});
          break;
        }catch(error){
          // One retry only before response headers, within the same total budget.
          // HTTP errors, malformed payloads and body failures are not replayed.
          if(attempt>0||controller.signal.aborted)throw error;
        }
      }
      if (!response.ok) throw new BridgeError('UPSTREAM_HTTP', 502, `上游读取失败（HTTP ${response.status}）。`);
      const text = await response.text();
      if (text.length > 12_000_000) throw new BridgeError('UPSTREAM_SCHEMA',502,'上游响应超过限制。');
      try { return JSON.parse(text); } catch { throw new BridgeError('UPSTREAM_SCHEMA',502,'上游未返回有效 JSON。'); }
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      const cause=(error as {cause?:{code?:string}})?.cause?.code;
      const timedOut=controller.signal.aborted || ['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'].includes(cause||'');
      throw new BridgeError(timedOut?'UPSTREAM_TIMEOUT':'UPSTREAM_UNAVAILABLE',timedOut?504:502,timedOut?'上游读取超时。':'上游暂时不可达。');
    } finally { clearTimeout(timer); }
  }
  snapshot(fresh=false): Promise<Snapshot> {
    if (!fresh && this.cached && this.now()-this.cached.observedAt<this.config.cacheMs) return Promise.resolve(this.cached);
    if (!fresh && this.inflight) return this.inflight;
    const revision=this.revision;
    const task = this.json('/api/public/probe-servers').then(raw=>{
      // An older HTTP read must not undo a newer WS visibility change or disable.
      if(revision!==this.revision) {
        if(this.cached)return this.cached;
        throw new BridgeError('UPSTREAM_SUPERSEDED',503,'快照读取期间上游状态已变化，请重试。');
      }
      return this.accept(raw);
    });
    if (fresh) return task;
    this.inflight=task;
    void task.finally(()=>{if(this.inflight===task)this.inflight=undefined;}).catch(()=>{});
    return task;
  }
  accept(raw:unknown): Snapshot {
    let snapshot: Snapshot;
    try { snapshot=normalizeSnapshot(raw,this.now()); } catch { throw new BridgeError('UPSTREAM_SCHEMA',502,'上游快照结构无效。'); }
    this.revision++;
    if (!snapshot.enabled) { this.cached=undefined; throw new BridgeError('PROBE_DISABLED',503,'上游未开放探针展示。'); }
    this.cached=snapshot;
    return snapshot;
  }
  invalidate() { this.revision++;this.cached=undefined; }
}
