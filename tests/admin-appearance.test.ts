import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../web/admin/appearance.js', import.meta.url), 'utf8');
const key = 'leobridge.admin.appearance';

function page(options: { stored?: string; systemDark?: boolean; blockRead?: boolean; blockWrite?: boolean } = {}) {
  const values = new Map<string, string>();
  if (options.stored !== undefined) values.set(key, options.stored);
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem(name: string, value: string) {
      if (options.blockWrite) throw new Error('Storage unavailable');
      values.set(name, value);
    },
  };
  const media = Object.assign(new EventTarget(), { matches: options.systemDark ?? false });
  const buttons = ['system', 'light', 'dark'].map(appearance => {
    const attributes = new Map<string, string>();
    return Object.assign(new EventTarget(), {
      dataset: { appearance },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name),
    });
  });
  const control = { querySelectorAll: () => buttons };
  let parsed = false;
  const document = Object.assign(new EventTarget(), {
    documentElement: { dataset: {} as Record<string, string> },
    readyState: 'loading',
    getElementById: (id: string) => parsed && id === 'appearance' ? control : null,
  });
  const window = Object.assign(new EventTarget(), { matchMedia: () => media });
  Object.defineProperty(window, 'localStorage', { get() {
    if (options.blockRead) throw new Error('Storage blocked');
    return storage;
  } });
  runInNewContext(script, { window, document });
  return {
    theme: () => document.documentElement.dataset.theme,
    stored: () => values.get(key),
    selected() {
      const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true');
      assert.equal(pressed.length, 1, 'exactly one appearance button is selected');
      return pressed[0]!.dataset.appearance;
    },
    ready() { parsed = true; document.readyState = 'interactive'; document.dispatchEvent(new Event('DOMContentLoaded')); },
    select(value: string) { buttons.find(button => button.dataset.appearance === value)!.dispatchEvent(new Event('click')); },
    system(dark: boolean) { media.matches = dark; media.dispatchEvent(new Event('change')); },
    otherTab(value: string | null, name: string | null = key, area: unknown = storage) {
      window.dispatchEvent(Object.assign(new Event('storage'), { key: name, newValue: value, storageArea: area }));
    },
  };
}

test('first visit stays dark even on a light system; saved light applies before the control is parsed', () => {
  const first = page();
  assert.equal(first.theme(), 'dark');
  first.ready();
  assert.equal(first.selected(), 'dark');
  const saved = page({ stored: 'light', systemDark: true });
  assert.equal(saved.theme(), 'light');
  saved.ready();
  assert.equal(saved.selected(), 'light');
  assert.equal(page({ stored: 'unknown' }).theme(), 'dark');
});

test('explicit day and night choices persist and ignore subsequent system changes', () => {
  const tab = page(); tab.ready();
  tab.select('light'); tab.system(true);
  assert.equal(tab.theme(), 'light');
  assert.equal(tab.stored(), 'light');
  assert.equal(page({ stored: tab.stored(), systemDark: true }).theme(), 'light');
  tab.select('dark'); tab.system(false);
  assert.equal(tab.theme(), 'dark');
  assert.equal(tab.stored(), 'dark');
});

test('system mode persists as a preference and follows live changes in both directions', () => {
  const tab = page({ systemDark: false }); tab.ready();
  tab.select('system');
  assert.equal(tab.theme(), 'light');
  assert.equal(tab.stored(), 'system');
  tab.system(true);
  assert.equal(tab.theme(), 'dark');
  tab.system(false);
  assert.equal(tab.theme(), 'light');
  assert.equal(tab.selected(), 'system');
  assert.equal(page({ stored: tab.stored(), systemDark: true }).theme(), 'dark');
});

test('blocked storage reads or writes do not break in-page choices or system tracking', () => {
  for (const options of [{ blockRead: true }, { blockWrite: true }]) {
    const tab = page(options); tab.ready();
    tab.select('light');
    assert.equal(tab.theme(), 'light');
    tab.select('system'); tab.system(true);
    assert.equal(tab.theme(), 'dark');
    tab.system(false);
    assert.equal(tab.theme(), 'light');
  }
});

test('other tabs synchronize preferences; unrelated storage and session storage are ignored', () => {
  const tab = page(); tab.ready();
  tab.otherTab('light', 'unrelated');
  tab.otherTab('light', key, {});
  assert.equal(tab.theme(), 'dark');
  tab.otherTab('light');
  assert.equal(tab.theme(), 'light');
  assert.equal(tab.selected(), 'light');
  tab.otherTab('system'); tab.system(true);
  assert.equal(tab.theme(), 'dark');
  assert.equal(tab.selected(), 'system');
  tab.otherTab(null, null); tab.system(false);
  assert.equal(tab.theme(), 'dark');
  assert.equal(tab.selected(), 'dark');
});
