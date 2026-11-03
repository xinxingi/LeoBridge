import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../src/core/config.ts';
import { Upstream } from '../src/upstream/client.ts';
import { IDENTITY_FIELDS, resolveBindings, type Binding } from '../src/core/identity.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
// Initial bootstrap only. Never replace existing identity assignments automatically.
try {
  const original=await readFile('.dev.vars','utf8');const env=parseEnv(original) as Record<string,string>;
  if(env.BRIDGE_BINDINGS)throw new Error('Bindings already exist; review them manually rather than regenerating IDs.');
  const config=readConfig(env);
  const rawFile=process.argv[2];
  const snapshot=rawFile?normalizeSnapshot(JSON.parse(await readFile(rawFile,'utf8'))):await new Upstream(config).snapshot(true);
  if(!snapshot.enabled)throw new Error('Probe disabled.');
  const bindings:Binding[]=snapshot.servers.map(raw=>{
    const match:Binding['match']={};
    for(const key of IDENTITY_FIELDS) {
      // Avoid changing capacities/kernel versions making normal agent upgrades disruptive.
      if(!['name','cpu_model','cpu_threads','arch','region_country','provider_name'].includes(key))continue;
      const value=raw[key];
      if((typeof value==='string'&&value.trim())||(typeof value==='number'&&Number.isFinite(value)&&value>=0))match[key]=value;
    }
    return {id:randomUUID(),match};
  });
  resolveBindings(snapshot,bindings);
  const ping=Array.isArray(snapshot.servers[0]?.ping)?snapshot.servers[0].ping:[];
  const slots=['ct','cu','cm','bd','node_1','node_2','node_3','node_4'];
  const targets=Object.fromEntries(ping.filter((p):p is {key:string;label:string}=>!!p&&typeof p==='object'&&typeof p.key==='string'&&typeof p.label==='string').slice(0,8).map((p,i)=>[slots[i],{key:p.key,label:p.label}]));
  const quote=(value:unknown)=>`'${JSON.stringify(value).replace(/'/g,'\\u0027')}'`;
  await writeFile('.dev.vars',`${original.trimEnd()}\n\n# Explicit initial identity bindings; review when public descriptions change.\nBRIDGE_BINDINGS=${quote(bindings)}\nBRIDGE_PING_TARGETS=${quote(targets)}\n`,{mode:0o600});
  console.log(`Configured ${bindings.length} explicit bindings in private .dev.vars. No upstream values printed.`);
} catch {console.error('Cannot safely bootstrap bindings. Check configuration, connectivity, and unique descriptive fields; existing bindings are never replaced.');process.exitCode=1;}
