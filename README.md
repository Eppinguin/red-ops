# RED//OPS — Cyberpunk RED NPC Generator Web Port

A frontend-only Vite, Preact, and TypeScript port of [`n0lavar/cp_red_npc_generator`](https://github.com/n0lavar/cp_red_npc_generator). The original generation behavior remains the mechanical source of truth; the web application adds a canonical content catalog, concise in-app reference information, validation, partial rerolls, editing, an initiative-based encounter runner, local persistence, and multiple output formats.

No backend or Foundry module is required.

## Source pins

| Source | Pin | Purpose |
| --- | --- | --- |
| `n0lavar/cp_red_npc_generator` | `c3dbce65aeb0c812ceb9300ddb138ad2c7f0a8dd` | Generator behavior and configuration |
| `cyberpunk-red-team/fvtt-cyberpunk-red-core` | `v0.92.4` | Optional build-time reference enrichment |

Pins and file lists live in `upstream-manifest.json` and `foundry-content-manifest.json` so runtime code and synchronization scripts share one configuration source.

## Features

### Table-first cyberpunk TUI

- Unified high-contrast terminal visual system across the generator, encounter runner, random encounter builder, reference browser, NPC library, inspectors, and dialogs.
- Monospaced information hierarchy with larger minimum text sizes, tabular numbers, hard-edged panels, restrained scanlines, and consistent keyboard-focus states.
- Acid-green primary actions, cyan interactive data, orange source/context labels, and persistent enemy/neutral/ally/player disposition colors.
- Compact, sticky application command bar and encounter inspector on wide screens, with deliberate stacked layouts at tablet and mobile widths.
- Encounter rows remain dense enough for table use while preserving readable HP, armor, status, attacks, and actions.
- Random encounter previews use clear scene, secondary-roll, roster, vitals, attack, Skill Base, loadout, rule, and source sections instead of small chip-heavy layouts.

### Generator fidelity

- Complete TypeScript generation pipeline running in a module Web Worker.
- NumPy `RandomState`-compatible MT19937 subset, Gaussian cache, scalar choice behavior, and Python banker’s rounding.
- Upstream generation order, budgets, item equality, installation rules, paired cyberware, modifiers, armor, weapons, ammunition, equipment, drugs, junk, Trauma Team, identity, text output, and lightweight Foundry JSON.
- Deterministic generation for fixed seeds and inputs, except for the documented Faker boundary below.

### Web-app reference experience

- Canonical catalog combining generator entries with optional Foundry-enriched metadata.
- Search and filters for item type and provenance.
- Clickable skills, weapons, armor, cyberware, and inventory.
- Detail drawer with concise descriptions, mechanics, price, source references, installation requirements, provenance, selection reasons, and recorded data conflicts.
- Generator mechanics remain authoritative for balance; Foundry fills missing descriptive and structured fields. Conflicts are reported instead of silently overwritten.

### NPC operation

- Calculated HP, Seriously Wounded threshold, initiative, Death Save, armor, attack bases, Autofire bases, damage, ROF, and magazine values.
- Cyberware installation tree and capacity checks.
- Validation for weapon-to-skill mappings, missing skills, compatible ammunition, installation capacity, and unresolved catalog entries.
- Partial rerolls for identity, description, stats, skills, cyberware, weapons plus ammunition, armor, inventory, or the full loadout.
- Manual base-stat and trained-skill edits through command objects, with bounds checking and full recalculation.
- Revision history stored in native exports.


### Encounter building and running

- Persistent initiative-ordered combatant list with independent active-turn and selected-inspector state.
- Add the current generated NPC, any saved NPC, repeated independent copies, or minimal player-character records.
- Rules-based daytime, evening, and midnight encounter generator with crew-size scaling, regional percentile guidance, preview-first roster editing, and one-click creation of prepared encounters.
- Multi-faction results retain explicit Side A/Side B team labels even when both rolls produce the same faction. Each group’s enemy, neutral, ally, or player disposition can be changed before adding it.
- Every secondary table roll is exposed in one compact reroll strip. Scene reactions, faction selections, offer responses, arrival timers, and nested story-subject rolls can each be rerolled without changing the street percentile or any other secondary result.
- Rerolling a secondary result rebuilds only its dependent scene data while preserving compatible edited counts, dispositions, loadout choices, and stable group identities.
- Readable encounter previews with vitals, attacks, ROF, Combat Number, structured official stat sheets, grouped Skill Bases, equipment, source notes, and explicit blocking when required data or a rules choice is unresolved.
- Supplied Trauma Team Doctor, Medical Assistant, Pilot, and two Security Officer records are represented as simplified Combat Number stat blocks. Missing REF/full STAT data remains manual rather than inferred.
- Automated Turrets use Combat Number 14 and require the GM to select one of the official weapon packages before materialization; the app does not choose a loadout implicitly.
- The complete supplied Cyberpsycho loadout includes Pain Editor and Subdermal Armor, with Pain Editor behavior enabled in the tracker.
- Editable initiative for every combatant plus one-click rolls for NPCs or everyone with an initiative base.
- Always-visible HP, body/head SP, conditions, critical injuries, held actions, cover, primary attacks, and stat-block access. Enemy, neutral, ally, and player rows use distinct persistent disposition colors.
- Every initiative row supports inline renaming and direct removal; the inspector also exposes editable name and disposition controls.
- Attack buttons display and roll the actual effective base, including Seriously Wounded, condition, and critical-injury penalties.
- Damage workflow for body/head armor, ablation, HP damage, head-location multiplier, Seriously Wounded state, and single-step undo.
- Ammunition expenditure and reloads, cover HP, held actions, custom conditions, critical-injury penalties, and Death Save escalation.
- Persistent sidebar inspector with full generated stats, skills, attacks, gear, cyberware, tactics, and GM notes.
- Encounter JSON export and browser-local active-encounter persistence. Undo history is intentionally memory-only and bounded.

### Storage and output

- Browser-local NPC library using IndexedDB.
- API keys are removed before worker responses, browser storage, native exports, and CLI output.
- Native versioned JSON, Markdown, original text output, lightweight Foundry JSON, printable sheet, and reproducible upstream CLI command.
- AI descriptions are optional and sent directly from the browser to the configured OpenAI-compatible endpoint. Generated item summaries and structured mechanics from the canonical catalog are included as grounding context so the model does not need to invent equipment behavior.

## Run locally

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

## Data synchronization

### Original generator data

The app can fetch the pinned upstream configuration at runtime. For a self-contained build, vendor it first:

```bash
npm run sync:upstream
```

This writes the files listed in `upstream-manifest.json` under `public/upstream/`.

### Foundry reference enrichment

The repository includes an intentionally empty fallback at `public/content/foundry/catalog.json`. The application remains fully functional with generator-derived summaries and mechanics when enrichment is absent.

To build the optional reference snapshot from the pinned Foundry release:

```bash
npm run content:sync-foundry
```

A local checkout can be used instead of the GitLab API:

```bash
FOUNDRY_SOURCE_DIR=/path/to/fvtt-cyberpunk-red-core npm run content:sync-foundry
```

Optional environment variables include `FOUNDRY_REF`, `FOUNDRY_COMMIT`, `GITLAB_TOKEN`, `CONTENT_SYNC_CONCURRENCY`, and `CONTENT_OUTPUT_DIR`.

The synchronizer:

1. Enumerates YAML documents from the configured pack roots through the GitLab API.
2. Parses the current Foundry item schema.
3. Normalizes supported records into the app’s canonical catalog model.
4. Deduplicates IDs deterministically.
5. Records the source ref, commit, pack, document ID, provenance, item count, and SHA-256 content hash.
6. Writes files atomically to `public/content/foundry/`.

Supported records currently include ammunition, armor, clothing, cyberdecks, cyberware, drugs, gear, upgrades, programs, roles, skills, vehicles, weapons, and critical injuries.

Review generated content and its applicable licensing/policy obligations before redistribution. The application is designed to use concise descriptions and structured metadata, not to reproduce complete rulebook text.

## Commands

```bash
npm run dev                    # Development server
npm run build                  # Strict TypeScript build and Vite bundle
npm run preview                # Preview production output
npm test                       # Vitest engine tests and Node ingestion tests
npm run test:watch             # Vitest watch mode
npm run test:content           # Foundry normalizer tests only
npm run sync:upstream          # Vendor pinned generator configuration
npm run content:sync-foundry   # Build optional Foundry enrichment snapshot
```

## Architecture

```text
Original generator configs ──► TypeScript generator engine
                                  │
Foundry pack YAML ──► build-time normalizer
                                  │
                                  ▼
                         Canonical catalog
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
             Reference UI     Validation     NPC enrichment
                                                   │
                                                   ▼
                                             NPC view model
                                                   │
                   ┌───────────────┬──────────────────┬───────────────┬───────────────┐
                   ▼               ▼                  ▼               ▼
              IndexedDB       Encounter runner   Native JSON      Markdown / Foundry
```

Important modules:

```text
src/
  App.tsx                         Main generator, encounter, refine, reference, and library UI
  worker.ts                       Catalog, generation, reroll, and edit boundary
  storage.ts                      IndexedDB persistence with credential stripping
  components/
    DetailDrawer.tsx              Complete catalog-entry detail view
    ReferenceBrowser.tsx          Searchable reference catalog
    NpcLibrary.tsx                Saved NPC management
    EncounterTracker.tsx          Encounter builder, initiative list, damage flow, and inspector
  content/
    types.ts                      Canonical catalog and provenance contracts
    catalog.ts                    Normalization, matching, merge policy, conflicts
    glossary.ts                   Short rules terminology help
  encounter/
    types.ts                      Encounter state and action contracts
    model.ts                      Pure combat reducer, damage, initiative, attacks, and undo
    storage.ts                    Active encounter persistence with Map serialization
  engine/
    generator.ts                  Ported generation pipeline
    random.ts                     NumPy-compatible RNG subset
    domain.ts                     Items, inventories, modifiers, compatibility quirks
    identity.ts                   Identity and optional AI description payload
    enrich.ts                     Combat summary, validation, explanations
    refine.ts                     Pure partial-reroll and edit commands
    format.ts                     Text, view-model, CLI, and Foundry serialization
    export.ts                     Native JSON and Markdown adapters
scripts/
  sync-upstream.mjs               Pinned generator data vendoring
  sync-foundry-content.mjs        GitLab synchronization and atomic snapshot output
  lib/foundry-normalize.mjs       Testable Foundry document normalizer
```

## Data authority and conflict policy

The generator and Foundry data serve different purposes:

- **Generator values** control random selection and mechanical balance.
- **Foundry values** enrich descriptions, source information, categories, brands, electronic status, concealability, hands, installation metadata, and other missing fields.
- When both sources define a mechanical value, the generator value remains authoritative unless a reviewed manual mapping changes the policy.
- Every disagreement is exposed through `CatalogConflict` and displayed in the detail drawer.

Matching uses normalized canonical names, aliases, item type, quality, and pack preference. Reviewed exceptions can be added to `src/content/manual-mappings.json` without changing engine code. Unqualified generator weapons preferentially match the standard-quality Foundry record.

## Security and privacy

- The app is frontend-only and has no application server.
- AI credentials remain in component state only.
- `model_api_key` is set to `null` before worker results, IndexedDB records, native JSON, and saved options are serialized.
- Generated CLI commands use `$MODEL_API_KEY` rather than embedding a credential.
- The AI endpoint must explicitly allow browser CORS requests.
- Browser-local saves remain on the current browser profile unless the user exports them.

## Testing strategy

Tests cover:

- NumPy-compatible RNG sequences and Python rounding.
- Upstream item identity and clone-ordering quirks.
- Deterministic generation.
- Canonical content matching, enrichment, quality handling, and conflict reporting.
- Current Foundry weapon-schema normalization, including `magazine.max` rather than the currently loaded value.
- Partial rerolls and bounded stat/skill commands.
- API-key redaction from native exports.
- Encounter initiative ordering, armor ablation, head damage, Seriously Wounded penalties, turn advancement, Death Saves, and undo.

The ingestion normalizer is isolated from networking so schema fixtures can be tested without GitLab access.

## Faker compatibility boundary

The Python project depends on Faker without pinning a version, so names can vary between Python installations. This port pins `@faker-js/faker` and maps Python Faker locales to the closest browser locale. Nationality weighting, sex, age, seed consumption, and transliteration remain deterministic, but first and last names are not guaranteed to be byte-identical to every possible Python Faker installation.

## Licensing and content boundaries

This project is GPL-3.0-only because it translates GPL-licensed upstream code. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

Cyberpunk RED names and game content belong to their respective owners. This is an unofficial fan utility. Keep descriptions concise, preserve source attribution, and require legally owned books for complete official wording. Do not use the synchronization pipeline to reconstruct or redistribute full copyrighted rulebook text or art without permission.
