# RED//OPS

RED//OPS is a frontend-only Vite + Preact + TypeScript app for generating Cyberpunk RED NPCs, browsing reference data, and running encounters. It ports the behavior of [`n0lavar/cp_red_npc_generator`](https://github.com/n0lavar/cp_red_npc_generator) and layers on a catalog, editing tools, partial rerolls, local persistence, and export options.

No backend or Foundry module is required.

## What it does

- Generates NPCs with the upstream rules and RNG behavior.
- Shows a searchable reference catalog with source-aware data.
- Lets you edit stats, skills, gear, and loadouts.
- Supports partial rerolls instead of forcing a full regeneration.
- Runs encounters with initiative order, damage, conditions, and undo.
- Stores saved NPCs and active encounters in the browser.
- Exports JSON, Markdown, printable sheets, and Foundry-friendly data.

## Source data

| Source | Pin | Purpose |
| --- | --- | --- |
| `n0lavar/cp_red_npc_generator` | `c3dbce65aeb0c812ceb9300ddb138ad2c7f0a8dd` | Generator behavior and configuration |
| `cyberpunk-red-team/fvtt-cyberpunk-red-core` | `v0.92.4` | Optional build-time reference enrichment |

The pinned file lists live in `upstream-manifest.json` and `foundry-content-manifest.json`.

## Running locally

Node.js 22.12 or newer is recommended.

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

## Useful commands

```bash
npm run dev                    # Development server
npm run build                  # TypeScript build + Vite bundle
npm run preview                # Preview production output
npm test                       # Vitest + Node tests
npm run test:watch             # Vitest watch mode
npm run test:content           # Foundry normalization tests
npm run sync:upstream          # Vendor pinned generator data
npm run content:sync-foundry   # Build optional Foundry snapshot
```

## Data sync

### Upstream generator data

The app can fetch the pinned upstream config at runtime. For a self-contained build, vendor it first:

```bash
npm run sync:upstream
```

This writes the files listed in `upstream-manifest.json` to `public/upstream/`.

### Foundry enrichment

`public/content/foundry/catalog.json` is intentionally empty by default. The app still works without enrichment, using generator data for summaries and mechanics.

To build the optional reference snapshot from the pinned Foundry release:

```bash
npm run content:sync-foundry
```

You can point the sync at a local checkout instead of the GitLab API:

```bash
FOUNDRY_SOURCE_DIR=/path/to/fvtt-cyberpunk-red-core npm run content:sync-foundry
```

Optional environment variables: `FOUNDRY_REF`, `FOUNDRY_COMMIT`, `GITLAB_TOKEN`, `CONTENT_SYNC_CONCURRENCY`, and `CONTENT_OUTPUT_DIR`.

## Project layout

```text
src/
  App.tsx            Main UI
  worker.ts          Generator, reroll, and edit boundary
  storage.ts         IndexedDB persistence
  components/        UI panels and dialogs
  content/           Canonical catalog and glossary
  encounter/         Encounter state, rules, and storage
  engine/            Generator, RNG, formatting, and export logic
scripts/             Sync and normalization scripts
```

## Testing

Tests cover RNG behavior, generator output, catalog matching, content normalization, partial rerolls, exports, and encounter rules. The content normalizer is isolated from networking so fixtures can be tested offline.

## Licensing

This project is GPL-3.0-only because it translates GPL-licensed upstream code. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

Cyberpunk RED names and game content belong to their respective owners. This is an unofficial fan utility. Keep descriptions concise, preserve source attribution, and avoid reproducing full copyrighted rulebook text or art without permission.
