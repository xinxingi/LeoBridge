# LeoBridge adaptations of Adhesive Note

Historical archive: the application copy and its build scripts have been removed. Paths below refer to that former copy, not files in this archive.

Source: stqfdyr/komari-theme-adhesive-note v1.0.0, immutable commit `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`. Original MIT license and THIRD_PARTY attribution are retained; `UPSTREAM.json` records copied files' pre-edit SHA-256. The actual paper layout, rendering, assets, routes and charts originate from that theme. No official komari-web code (which lacks a repository license) was copied into this application.

Local changes:

- Root paths retained for a dedicated immutable installation hostname; homepage `/`, detail `/instance/:uuid`, HTTP POST and WebSocket `/api/rpc2`.
- Missing numeric fields render `—`, valid zero stays zero. Unknown/offline/stale states are distinct; upstream failure is visible. Unspecified expiry and price are not shown as unlimited/free; billing metrics remain unsupported.
- New observation timestamps participate in status comparison. Repeated cached responses do not create fresh chart samples. Source historical totals are used per point; current capacity does not overwrite missing historical totals. Missing chart values remain null gaps. Decorative vertical jitter was removed from metric curves.
- History range options come from `settings.bridge.history_hours`; errors are displayed and old-range/live fallback curves are not mislabelled as newly requested history. Source Ping bucket `loss_percent` has a separate percentage chart; negative latency is not converted into an invented loss percentage.
- Snapshot polling uses the original RPC2 protocol over a shared WebSocket with HTTP fallback, at 5 seconds rather than 2. Public static metadata refreshes every 30 seconds. Historical calls have a 110-second deadline, other calls 30 seconds. Hidden/unmounted pages close their socket; obsolete close/message handlers cannot affect a new connection.
- Removed the theme's link to a nonexistent Komari administration UI. It runs only the read-only public protocol; LeoBridge administration is on a separate origin.
- Existing self-hosted fonts and Twemoji flags are retained. Full OFL/CC-BY text is added in licenses/. Source license URLs were retrieved 2026-11-02: Google Fonts `ofl/architectsdaughter/OFL.txt`, lxgw/LxgwWenKai `OFL.txt`, jdecked/twemoji `LICENSE-GRAPHICS`; these texts are supplemental attribution, not evidence of a different asset origin.

The historical manifest was `LeoBridgeAdhesiveNote`, version `1.0.0-leobridge.1`; its adapted bytes differ from the official ZIP. Current builds do not recreate it. See the [consumer contract](../../../research/komari-frontend.md) for the applicable protocol and historical behavior.
