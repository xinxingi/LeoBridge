import { isRecord, type Snapshot, type UpstreamServer } from './model.js';

// These are public descriptive attributes, not claimed immutable upstream IDs.
// Changes require an explicit binding update; identical descriptions remain ambiguous.
export const IDENTITY_FIELDS = [
  'name', 'cpu_model', 'cpu_cores', 'cpu_threads', 'mem_total', 'disk_total',
  'os', 'kernel', 'arch', 'region_country', 'region_name', 'region_city', 'provider_name',
] as const;

export interface Binding {
  id: string;
  match: Record<string, string | number | boolean>;
}

export interface ResolvedServer {
  id: string;
  index: number;
  raw: UpstreamServer;
}

export class IdentityError extends Error {
  readonly status = 409;
  constructor(readonly code: string) {
    // No selectors, names or upstream values in errors sent to visitors or logs.
    super('Server identity bindings require review; refusing an ambiguous or changed mapping.');
    this.name = 'IdentityError';
  }
}

export function parseBindings(value: unknown): Binding[] {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new IdentityError('INVALID_IDENTITY_CONFIG'); }
  }
  if (!Array.isArray(parsed)) throw new IdentityError('INVALID_IDENTITY_CONFIG');
  const ids = new Set<string>();
  return parsed.map((binding): Binding => {
    if (!isRecord(binding) || typeof binding.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(binding.id)
      || ids.has(binding.id) || !isRecord(binding.match) || Object.keys(binding.match).length === 0) {
      throw new IdentityError('INVALID_IDENTITY_CONFIG');
    }
    const match: Binding['match'] = {};
    for (const [field, expected] of Object.entries(binding.match)) {
      if (!(IDENTITY_FIELDS as readonly string[]).includes(field)
        || !((typeof expected === 'string' && expected.trim() !== '')
          || (typeof expected === 'number' && Number.isFinite(expected) && expected >= 0))) {
        throw new IdentityError('INVALID_IDENTITY_CONFIG');
      }
      match[field] = expected;
    }
    ids.add(binding.id);
    return { id: binding.id, match };
  });
}

/** Resolve fresh indices on every snapshot; never persist an index as identity. */
export function resolveBindings(snapshot: Snapshot, bindings: Binding[]): ResolvedServer[] {
  const validated = parseBindings(bindings);
  if (!snapshot.enabled) return [];
  const byIndex = new Map<number, ResolvedServer>();
  for (const binding of validated) {
    const matches: number[] = [];
    snapshot.servers.forEach((server, index) => {
      if (Object.entries(binding.match).every(([key, expected]) => server[key] === expected)) matches.push(index);
    });
    if (matches.length === 0) throw new IdentityError('IDENTITY_MISSING');
    if (matches.length > 1) throw new IdentityError('IDENTITY_AMBIGUOUS');
    const index = matches[0]!;
    if (byIndex.has(index)) throw new IdentityError('IDENTITY_OVERLAP');
    byIndex.set(index, { id: binding.id, index, raw: snapshot.servers[index]! });
  }
  if (byIndex.size !== snapshot.servers.length) throw new IdentityError('IDENTITY_UNBOUND');
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Comparison guard for an index-based history request, before and after its fetch. */
export function identityVector(snapshot: Snapshot, bindings: Binding[]): string[] {
  return resolveBindings(snapshot, bindings).map(server => server.id);
}
