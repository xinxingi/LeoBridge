import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fetchCatalog, type PublicFetcher } from '../src/themes/catalog.ts';
import { CatalogStars } from '../src/themes/stars.ts';

async function catalog(repos: string[]) {
  return fetchCatalog('cfsm', async () => Response.json({ schema: 1, themes: repos.map((repo, i) => ({ id: `theme-${i}`, title: 'Duplicate names allowed', url: `https://github.com/${repo}`, branch: 'build' })) }));
}

test('stars use repository identities, preserve zero, sort descending and leave unknown last', async () => {
  const input = await catalog(['a/zero', 'a/popular', 'a/missing', 'A/POPULAR', 'a/negative', 'a/string', 'a/fraction']);
  const service = new CatalogStars(); const calls: string[] = [];
  const output = await service.enrich(input, async (url, init) => {
    calls.push(String(url)); assert.equal(new Headers(init?.headers).has('authorization'), false);
    const repo = String(url).split('/').pop()!;
    if (repo === 'missing') return new Response(null, { status: 404 });
    return Response.json({ stargazers_count: { zero: 0, popular: 1234, negative: -1, string: '123', fraction: 1.5 }[repo] });
  });
  assert.deepEqual(output.entries.map(e => e.id), ['theme-1', 'theme-3', 'theme-0', 'theme-2', 'theme-4', 'theme-5', 'theme-6']);
  assert.deepEqual(output.entries.map(e => e.stars), [1234, 1234, 0, null, null, null, null]);
  assert.equal(calls.length, 6); assert.ok(output.entries[0].starsFetchedAt);
  assert.equal(output.entries[3].starsFetchedAt, null);
  assert.equal(input.entries[0].id, 'theme-0'); assert.equal('stars' in input.entries[0], false);
  assert.ok(output.entries.every(e => e.canAttemptInstall && e.compatibility === 'unverified'));
});

test('star caches survive new scoped fetchers, expire and retry failures without inventing zero', async () => {
  let now = Date.now(), calls = 0;
  const service = new CatalogStars(() => now), input = await catalog(['a/ok', 'a/broken']);
  const fetcher: PublicFetcher = async url => { calls++; if (String(url).endsWith('/broken')) throw new Error('unavailable'); return Response.json({ stargazers_count: calls }); };
  await service.enrich(input, fetcher); assert.equal(calls, 2);
  await service.enrich(input, (url, init) => fetcher(url, init)); assert.equal(calls, 2);
  now += 5 * 60_000 + 1; await service.enrich(input, fetcher); assert.equal(calls, 3);
  now += 60 * 60_000; await service.enrich(input, fetcher); assert.equal(calls, 5);
});

test('rate limits stop queued requests; optional metadata has a bounded deadline and concurrency', async () => {
  const input = await catalog(Array.from({ length: 20 }, (_, i) => `a/repo${i}`));
  let calls = 0, now = Date.now(); const service = new CatalogStars(() => now);
  const limited: PublicFetcher = async () => { calls++; return new Response(null, { status: 429 }); };
  const output = await service.enrich(input, limited);
  assert.ok(calls <= 6); assert.equal(output.entries.length, 20); assert.ok(output.entries.every(e => e.stars === null));
  const before = calls; await service.enrich(input, limited); assert.equal(calls, before);
  now += 5 * 60_000 + 1;
  await service.enrich(input, limited); assert.ok(calls > before);
  let active = 0, maxActive = 0, aborted = 0;
  const timeout = await new CatalogStars(Date.now, 30).enrich(input, async (_url, init) => {
    active++; maxActive = Math.max(active, maxActive);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { active--; aborted++; reject(new Error('abort')); }, { once: true });
    });
  });
  assert.ok(maxActive <= 6); assert.ok(aborted > 0); assert.equal(active, 0);
  assert.ok(timeout.entries.every(e => e.stars === null));
});

test('catalog cards display exact formatted stars, genuine zero and unavailable distinctly', async () => {
  const source = await readFile(new URL('../web/admin/app.js', import.meta.url), 'utf8');
  const element = (tag: string, text?: string, className?: string) => ({ tag, text, className, children: [] as any[], append(...children: any[]) { this.children.push(...children); } });
  const render = runInNewContext(source.slice(source.indexOf('function catalogCard('), source.indexOf('async function render()')) + '\ncatalogCard', {
    element, displayText: (value: string) => value, link: element, button: element,
  });
  for (const [stars, expected] of [[1234, '★ 1,234 Stars'], [0, '★ 0 Stars'], [null, '☆ - Stars']] as const) {
    const card = render({ name: 'Example', stars, starsFetchedAt: stars === null ? null : '2026-11-03T00:00:00Z' }, 'komari');
    const label = card.children.find((e: any) => e.className === 'theme-stars');
    assert.equal(label.text, expected); assert.match(label.title, /GitHub 仓库 Star 数/);
  }
});
