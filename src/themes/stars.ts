import { fetchPublicJson, repositoryParts, type Catalog, type CatalogEntry, type PublicFetcher } from './catalog.ts';

interface Stars { stars: number | null; starsFetchedAt: string | null; }
export type StarredEntry = CatalogEntry & Stars;
const SUCCESS_TTL = 60 * 60_000, FAILURE_TTL = 5 * 60_000;

/** Optional repository popularity, independent of immutable package/compatibility facts. */
export class CatalogStars {
  private cache = new Map<string, { expires: number; value: Stars }>();
  private limitedUntil = 0;
  constructor(private now = Date.now, private budgetMs = 15_000) {}

  async enrich(catalog: Catalog, fetcher: PublicFetcher): Promise<Omit<Catalog, 'entries'> & { entries: StarredEntry[] }> {
    const entries: StarredEntry[] = catalog.entries.map(entry => ({ ...entry, stars: null, starsFetchedAt: null }));
    const repositories = new Map<string, StarredEntry[]>();
    for (const entry of entries) {
      const repo = repositoryParts(entry.repositoryUrl);
      if (!repo) continue;
      const key = `${repo.owner}/${repo.repo}`.toLowerCase();
      const group = repositories.get(key) || []; group.push(entry); repositories.set(key, group);
    }
    for (const [key, cached] of this.cache) if (cached.expires <= this.now()) this.cache.delete(key);
    const queue = [...repositories], deadline = this.now() + this.budgetMs;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (index < queue.length) {
        const [key, group] = queue[index++];
        const cached = this.cache.get(key);
        if (cached) { for (const entry of group) Object.assign(entry, cached.value); continue; }
        if (this.now() >= deadline || this.now() < this.limitedUntil) continue;
        let value: Stars = { stars: null, starsFetchedAt: null };
        try {
          const data = await fetchPublicJson(`https://api.github.com/repos/${key}`, {
            maxBytes: 256_000, timeoutMs: Math.max(1, deadline - this.now()),
            fetcher: async (input, init) => {
              const response = await fetcher(input, init);
              // Leave some unauthenticated API quota for catalog/install operations.
              const remaining = response.headers.get('x-ratelimit-remaining');
              if (response.status === 403 || response.status === 429 || (remaining !== null && Number(remaining) <= 10)) {
                const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
                this.limitedUntil = Math.max(this.now() + FAILURE_TTL, Math.min(reset || 0, this.now() + SUCCESS_TTL));
              }
              return response;
            },
          });
          const count = (data as { stargazers_count?: unknown } | null)?.stargazers_count;
          if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) value = { stars: count, starsFetchedAt: new Date(this.now()).toISOString() };
        } catch { /* Optional metadata failure must not hide an installable theme. */ }
        if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: this.now() + (value.stars === null ? FAILURE_TTL : SUCCESS_TTL), value });
        for (const entry of group) Object.assign(entry, value);
      }
    }));
    // Stable sort keeps catalog order for equal counts, with unknown after genuine zero.
    entries.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
    return { ...catalog, entries };
  }
}
