# LeoBridge adaptations of the official Komari frontend

Source: komari-monitor/komari-web, commit `bed58b589da63232a17681b1dbaed9eab2423078` (radix). Original file hashes are in UPSTREAM.json. Upstream has no standalone LICENSE; see SOURCE_TERMS.md and the unmodified UPSTREAM_README.md. The root project's MIT license does not cover this frontend.

- Copied the public homepage, node cards/table, details, metric dashboard, public contexts and their static dependencies. Administration, terminal, installation/recovery routes and PWA registration are excluded from the public entry point.
- Retained official Radix layout, themes, language controls, chart components and local flag/OS resources. Replaced the login entry with a read-only label. Removed the temporary-key cookie entry flow.
- Added a separate `komari-default-bed58b5` protocol profile. Official common:getNodes, common:getVersion and metric RPC calls are adapted independently of CFSM. The previous Adhesive Note profile remains for already-installed packages.
- Missing UI numeric values remain unknown (NaN in the UI model, null on the wire), not zero. Formatters and usage bars render an em dash. Status distinguishes unknown, stale and offline. Source failure clears live values and displays a notice. Polling is five seconds; hidden/unmounted pages close their connection.
- History preserves actual source timestamps/units and null gaps. Relative ranges only; no interpolation, EWMA or synthetic packet counts/percentiles. Added the source-bucket loss-percent chart. Unsupported metrics have no invented series. Historical requests allow 110 seconds and clear old-range data when changing range.
- The immutable adapted manifest is LeoBridgeKomariDefault / bed58b5-leobridge.1. Built from the root lockfile; no upstream scripts run automatically.

Compatibility evidence is recorded separately; build success alone is not browser acceptance.
