import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fetchCatalog, type PublicFetcher } from '../src/themes/catalog.ts';
import { CatalogStars, parseRepositoryStars } from '../src/themes/stars.ts';

function repositoryPage(repository: string, count: unknown) {
  return new Response(`<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({payload:{sidebarAbout:{stargazersPath:`/${repository}/stargazers`,stargazerCount:count}}})}</script>`);
}
function repoKey(url: string | URL | Request) { return new URL(String(url)).pathname.slice(1); }

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
    assert.equal(new URL(String(url)).hostname, 'github.com');
    return repositoryPage(repoKey(url), { zero: 0, popular: 1234, negative: -1, string: '123', fraction: 1.5 }[repo]);
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
  const fetcher: PublicFetcher = async url => { calls++; if (String(url).endsWith('/broken')) throw new Error('unavailable'); return repositoryPage(repoKey(url), calls); };
  await service.enrich(input, fetcher); assert.equal(calls, 2);
  await service.enrich(input, (url, init) => fetcher(url, init)); assert.equal(calls, 2);
  now += 5 * 60_000 + 1; await service.enrich(input, fetcher); assert.equal(calls, 3);
  now += 60 * 60_000; await service.enrich(input, fetcher); assert.equal(calls, 5);
});

test('page rate limits stop queued requests; optional metadata has a bounded deadline and concurrency', async () => {
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
    const descendants = (node: any): any[] => [node, ...node.children.flatMap(descendants)];
    const label = descendants(card).find((e: any) => e.className === 'theme-stars');
    assert.equal(label.text, expected); assert.match(label.title, /GitHub 仓库 Star 数/);
  }
});

test('GitHub page parser accepts audited payloads and exact legacy counters, rejecting unrelated or rounded numbers', async () => {
  assert.equal(parseRepositoryStars(await repositoryPage('a/theme', 12345).text(), 'A/THEME'), 12345);
  assert.equal(parseRepositoryStars(await repositoryPage('other/theme', 12345).text(), 'a/theme'), null);
  assert.equal(parseRepositoryStars('<script type="application/json" data-target="react-app.embeddedData">{"payload":{"codeViewRepoRoute":{"overview":{"sidebarAboutData":{"stargazerCount":0,"stargazersPath":"/a/theme/stargazers"}}}}}</script>', 'a/theme'), 0);
  assert.equal(parseRepositoryStars('<span id="repo-stars-counter-star" title="12,345">12.3k</span>', 'a/theme'), 12345);
  assert.equal(parseRepositoryStars('<span title="1,234" id="repo-stars-counter-star">1.2k</span>', 'a/theme'), 1234);
  for (const html of ['<span id="repo-stars-counter-star">1.2k</span>', '<span title="10,00" id="repo-stars-counter-star">1k</span>', '<h1>README: 9999 stars</h1>', '<span id="repo-network-counter" title="123">123</span>', '<script type="application/json" data-target="react-app.embeddedData">invalid json</script>']) assert.equal(parseRepositoryStars(html, 'a/theme'), null);
});

test('all 65 repositories load without consuming REST quota; concurrent loads coalesce', async () => {
  const input = await catalog(Array.from({length:65}, (_,i)=>`a/theme${i}`));
  let calls = 0;
  const service = new CatalogStars();
  const fetcher: PublicFetcher = async url => {
    calls++; assert.equal(new URL(String(url)).hostname, 'github.com');
    await new Promise(resolve => setImmediate(resolve));
    return repositoryPage(repoKey(url), Number(String(url).match(/theme(\d+)$/)![1]));
  };
  const [a,b] = await Promise.all([service.enrich(input, fetcher),service.enrich(input, fetcher)]);
  assert.equal(calls,65); assert.deepEqual(a,b);
  assert.deepEqual(a.entries.map(e=>e.stars),Array.from({length:65},(_,i)=>64-i));
});

test('refresh retries missing values; temporary failures retain dated counts for at most 24 hours', async () => {
  let now = Date.now(), broken = false, calls = 0;
  const input = await catalog(['a/theme']), service = new CatalogStars(()=>now);
  const fetcher: PublicFetcher = async url => { calls++; if (broken) throw new Error('unavailable'); return repositoryPage(repoKey(url), 99); };
  const first = await service.enrich(input,fetcher);
  now += 60*60_000+1; broken = true;
  const stale = await service.enrich(input,fetcher);
  assert.equal(stale.entries[0].stars,99); assert.equal(stale.entries[0].starsStale,true);
  assert.equal(stale.entries[0].starsFetchedAt,first.entries[0].starsFetchedAt);
  const before = calls; await service.enrich(input,fetcher); assert.equal(calls,before);
  now += 24*60*60_000;
  assert.equal((await service.enrich(input,fetcher)).entries[0].stars,null);
  broken = false;
  const retry = await service.enrich(input,fetcher,true);
  assert.equal(retry.entries[0].stars,99); assert.equal(retry.entries[0].starsStale,undefined);
});

test('repository redirects are validated and renamed repositories use their returned identity', async () => {
  const input = await catalog(['old/theme']), service = new CatalogStars();
  const output = await service.enrich(input,async url => String(url)==='https://github.com/old/theme'
    ? new Response(null,{status:301,headers:{location:'https://github.com/new/theme'}})
    : repositoryPage('new/theme',23));
  assert.equal(output.entries[0].stars,23);
  let requests=0;
  const invalid = await new CatalogStars().enrich(input,async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://raw.githubusercontent.com/other/theme/main/file'}});});
  assert.equal(requests,1); assert.equal(invalid.entries[0].stars,null);
});
