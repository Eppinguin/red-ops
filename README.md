# RED//OPS

RED//OPS is a frontend-only Vite + Preact + TypeScript app for generating Cyberpunk RED NPCs, browsing reference data, and running encounters. It ports the behavior of [`n0lavar/cp_red_npc_generator`](https://github.com/n0lavar/cp_red_npc_generator) and layers on a catalog, editing tools, partial rerolls, local persistence, and export options.

No backend or Foundry module is required.

## What it does

- Generates NPCs with the upstream rules and RNG behavior.
- Shows a searchable reference catalog with source-aware data.
- Edits any generated or hand-built NPC in place, with derived values previewed live.
- Rerolls a single section or identity field instead of forcing a full regeneration.
- Runs encounters with initiative order, damage, conditions, and undo.
- Stores saved NPCs and active encounters in the browser.
- Exports JSON, Markdown, printable sheets, and Foundry-friendly data.

## Source data

| Source | Pin | Purpose |
| --- | --- | --- |
| `n0lavar/cp_red_npc_generator` | `dfd4c08c4295c3d34f11a6c75c4d3ae5792ef2a4` | Generator behavior and configuration |
| `cyberpunk-red-team/fvtt-cyberpunk-red-core` | `v0.92.4` | Optional build-time reference enrichment |

The pinned file lists live in `upstream-manifest.json` and `foundry-content-manifest.json`.

## Running locally

Node.js 22.12 or newer is recommended.

```bash
pnpm install
pnpm run dev
```

Build and preview:

```bash
pnpm run build
pnpm run preview
```

## Useful commands

```bash
pnpm run dev                    # Development server
pnpm run build                  # TypeScript build + Vite bundle
pnpm run preview                # Preview production output
pnpm test                       # Vitest + Node tests
pnpm run test:watch             # Vitest watch mode
pnpm run test:content           # Foundry normalization tests
pnpm run sync:upstream          # Vendor pinned generator data
pnpm run content:sync-foundry   # Build optional Foundry snapshot
```

## Data sync

### Upstream generator data

The app can fetch the pinned upstream config at runtime. For a self-contained build, vendor it first:

```bash
pnpm run sync:upstream
```

This writes the files listed in `upstream-manifest.json` to `public/upstream/`.

### Foundry enrichment

`public/content/foundry/catalog.json` is intentionally empty by default. The app still works without enrichment, using generator data for summaries and mechanics.

To build the optional reference snapshot from the pinned Foundry release:

```bash
pnpm run content:sync-foundry
```

You can point the sync at a local checkout instead of the GitLab API:

```bash
FOUNDRY_SOURCE_DIR=/path/to/fvtt-cyberpunk-red-core pnpm run content:sync-foundry
```

Optional environment variables: `FOUNDRY_REF`, `FOUNDRY_COMMIT`, `GITLAB_TOKEN`, `CONTENT_SYNC_CONCURRENCY`, and `CONTENT_OUTPUT_DIR`.

## Project layout

```text
src/
  App.tsx            Main UI
  worker.ts          Generator and reroll boundary
  storage.ts         IndexedDB persistence
  components/        UI panels, the NPC editor, and dialogs
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
