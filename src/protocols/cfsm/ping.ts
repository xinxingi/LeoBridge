import { PING_SLOTS, type Config } from '../../core/config.ts';
import { normalizePingValue } from '../../upstream/series.ts';
export function applyPing(out: Record<string,unknown>, raw:unknown, targets:Config['pingTargets']) {
  const rows=Array.isArray(raw)?raw:[];
  for(const slot of PING_SLOTS) {
    out[`ping_${slot}`]=false; out[`loss_${slot}`]=false;
    const key=targets[slot]?.key; if(!key)continue;
    const matches=rows.filter(r=>r && r.key===key); if(matches.length!==1)continue;
    const p=matches[0];
    // -1 is no data, never timeout. A measured 100% loss has null latency.
    const sample=normalizePingValue(p.current_ms,p.loss_pct);
    out[`ping_${slot}`]=sample.latencyMs ?? (sample.state==='timeout'?null:false);out[`loss_${slot}`]=sample.lossPercent ?? false;
  }
}
