import { fetchPublicBytes, repositoryParts, type Catalog, type CatalogEntry, type PublicFetcher } from './catalog.ts';

interface Stars { stars: number | null; starsFetchedAt: string | null; starsStale?: boolean; }
export type StarredEntry = CatalogEntry & Stars;
const SUCCESS_TTL = 60 * 60_000, FAILURE_TTL = 5 * 60_000, STALE_TTL = 24 * SUCCESS_TTL;
const unknownStars = (): Stars => ({ stars: null, starsFetchedAt: null });
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Read exact repository metadata, never rounded "1.2k" text or arbitrary README numbers. */
export function parseRepositoryStars(html: string, repository: string): number | null {
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype=["']application\/json["']/i.test(script[1]) || !/\bdata-target=["']react-app\.embeddedData["']/i.test(script[1])) continue;
    try {
      const payload = JSON.parse(script[2])?.payload;
      const candidates = [payload?.sidebarAbout, payload?.codeViewRepoRoute?.overview?.sidebarAboutData, payload?.overview?.sidebarAboutData];
      for (const data of candidates) {
        if (typeof data?.stargazersPath === 'string' && data.stargazersPath.toLowerCase() === `/${repository.toLowerCase()}/stargazers` && validCount(data.stargazerCount)) return data.stargazerCount;
      }
    } catch { /* A different embedded payload is not a star count. */ }
  }
  // Legacy GitHub repository header exposes its exact count in title.
  const counter = html.match(/<span\b[^>]*\bid=["']repo-stars-counter-star["'][^>]*>[\s\S]*?<\/span>/i)?.[0];
  if (counter) {
    const title = counter.match(/\btitle=["']([\d,]+)["']/i)?.[1];
    const plain = counter.replace(/<[^>]+>/g, '').trim();
    const text = title ?? plain;
    if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
      const count = Number(text.replaceAll(',', '')); if (validCount(count)) return count;
    }
  }
  return null;
}

/** Popularity uses public repository pages, leaving REST quota for catalog/install. */
export class CatalogStars {
  private cache = new Map<string, { retryAt: number; value: Stars }>();
  private pending = new Map<string, Promise<Stars>>();
  private limitedUntil = 0;
  constructor(private now = Date.now, private budgetMs = 30_000) {}

  private async read(key: string, fetcher: PublicFetcher, deadline: number, previous?: Stars): Promise<Stars> {
    let value = unknownStars();
    try {
      let repository = key;
      const bytes = await fetchPublicBytes(`https://github.com/${key}`, {
        maxBytes: 2_000_000, timeoutMs: Math.max(1, Math.min(10_000, deadline - this.now())),
        fetcher: async (input, init) => {
          const repo = repositoryParts(String(input));
          if (!repo) throw new Error('Star metadata must stay on a GitHub repository page.');
          repository = `${repo.owner}/${repo.repo}`;
          const response = await fetcher(input, { ...init, headers: { ...init?.headers, Accept: 'text/html' } });
          if (response.status === 429) {
            const retry = Number(response.headers.get('retry-after'));
            this.limitedUntil = this.now() + Math.max(FAILURE_TTL, Math.min(Number.isFinite(retry) ? retry * 1000 : 0, SUCCESS_TTL));
          }
          return response;
        },
      });
      const count = parseRepositoryStars(new TextDecoder('utf-8', { fatal: true }).decode(bytes), repository);
      if (count !== null) value = { stars: count, starsFetchedAt: new Date(this.now()).toISOString() };
    } catch { /* Metadata failure must not hide an installable theme. */ }
    const success = value.stars !== null;
    if (!success && previous?.starsFetchedAt && this.now() - Date.parse(previous.starsFetchedAt) < STALE_TTL) value = { ...previous, starsStale: true };
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { retryAt: this.now() + (success ? SUCCESS_TTL : FAILURE_TTL), value });
    return value;
  }

  async enrich(catalog: Catalog, fetcher: PublicFetcher, refresh = false): Promise<Omit<Catalog, 'entries'> & { entries: StarredEntry[] }> {
    const entries: StarredEntry[] = catalog.entries.map(entry => ({ ...entry, ...unknownStars() }));
    const repositories = new Map<string, StarredEntry[]>();
    for (const entry of entries) {
      const repo = repositoryParts(entry.repositoryUrl);
      if (!repo) continue;
      const key = `${repo.owner}/${repo.repo}`.toLowerCase();
      const group = repositories.get(key) || []; group.push(entry); repositories.set(key, group);
    }
    const queue = [...repositories], deadline = this.now() + this.budgetMs;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (index < queue.length) {
        const [key, group] = queue[index++];
        const cached = this.cache.get(key);
        const previous = cached?.value.starsFetchedAt && this.now() - Date.parse(cached.value.starsFetchedAt) < STALE_TTL ? cached.value : undefined;
        if (cached && cached.retryAt > this.now() && !(refresh && (cached.value.stars === null || cached.value.starsStale))) {
          for (const entry of group) Object.assign(entry, previous ?? unknownStars()); continue;
        }
        if (this.now() >= deadline || this.now() < this.limitedUntil) {
          if (previous) for (const entry of group) Object.assign(entry, previous, { starsStale: true });
          continue;
        }
        let task = this.pending.get(key);
        if (!task) {
          task = this.read(key, fetcher, deadline, previous).finally(() => this.pending.delete(key));
          this.pending.set(key, task);
        }
        const value = await task;
        for (const entry of group) Object.assign(entry, value);
      }
    }));
    entries.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
    return { ...catalog, entries };
  }
}
