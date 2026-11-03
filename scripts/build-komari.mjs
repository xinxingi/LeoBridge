import { build } from 'vite'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
await build({ configFile: 'web/themes/komari/vite.config.ts' })
const out = 'dist/komari-public'
await mkdir(`${out}/licenses`, { recursive: true })
await cp('web/themes/komari/licenses', `${out}/licenses`, { recursive: true })
for (const name of ['LICENSE', 'THIRD_PARTY.md', 'UPSTREAM.json']) await cp(`web/themes/komari/${name}`, `${out}/${name}`)
const original = JSON.parse(await readFile('web/themes/komari/komari-theme.json', 'utf8'))
await writeFile(`${out}/komari-theme.json`, JSON.stringify({ ...original, short: 'LeoBridgeAdhesiveNote', version: `${original.version}-leobridge.1`, description: `${original.description} · LeoBridge protocol and missing-data adaptations` }, null, 2) + '\n')
