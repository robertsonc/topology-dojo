# Sitrep 01 — hw-catalog Phase 1: catalog core

Status: **done**, merged (PR #285). Next: Phase 2 (bind hardware + validate).

## What landed

- **Layout.** The seed package lives in `catalog/` — `schema/`, `data/`
  (was `seed/`), `fixtures/wiring/`, `tools/` — kept together as the brief
  asks. `catalog/data/` is the source of truth; `build_seed.py --out
catalog/data` still regenerates it byte-for-byte. The package README
  became `catalog/README.md` (new paths and commands); the brief is kept at
  `docs/futures/hw-catalog-build-prompt.md`. The rendered preview PNG
  (266 KB, no generator) was left out.
- **Generated types.** `src/catalog/types.generated.ts` is produced from
  `catalog.schema.json` by `json-schema-to-typescript` (pinned 15.0.4) and
  formatted with the repo's Prettier config (`npm run catalog:types`). A unit
  test and `npm run catalog:check` fail when it is stale.
  `optics.json` has no schema, so its type (`Optics`) is hand-written and the
  build shape-checks it.
- **Build.** `npm run catalog:build` lints with the TypeScript port of
  `check_seed.py` (`src/catalog/build.ts`; Ajv 8.20.0, draft 2020-12, formats
  not asserted — matching `jsonschema`'s default), refuses to publish on
  errors, and writes `public/catalog/catalog-<sha256-12>.json` plus
  `manifest.json` (`latest` + every published version). The hash covers the
  canonical JSON (sorted keys, entries sorted by id) of the bundle, so it
  depends on content only. Old bundles are kept; pinned documents need them.
- **Publishing.** Vite copies `public/catalog/` into `dist/`; the Worker reads
  bundles through `env.ASSETS` (`worker/catalog.ts`). Public HTTP requests to
  `/catalog/*` get a 404 from `worker/default-handler.ts` (decoded and
  case-folded first), because provenance rows name internal documents.
- **Loader.** `CatalogLoader` (`src/catalog/loader.ts`): fetch by version or
  latest, in-memory LRU (default 4 versions), failures not cached, bundle
  format and version verified. Sources: disk (`src/server/catalog.ts`) and
  ASSETS (`worker/catalog.ts`, one loader per isolate).
- **`resolveInterface(model, name)`** (`src/catalog/catalog.ts`) with
  `{member}` expansion, ported from `catalog_lib.py`.
- **CI.** The `check` job now runs the three Python tools on the same data
  and fixtures (linter, 14 wiring fixtures, parity golden) and
  `npm run catalog:check`.

## Python reference fixes

Found while porting; both are bugs in the spec, fixed in the spec rather than
copied into TypeScript:

1. `catalog_lib.resolve_interface` built `^…$` and used `re.match`. Python's
   `$` also matches before a trailing newline, so `"1/1/1\n"` resolved as
   member 1. Now `re.fullmatch`.
2. `check_seed.check_svg` read a missing `data-cx`/`data-cy` as NaN, and NaN
   never compares greater than the tolerance, so an anchor without
   coordinates passed silently. Now reported as `anchor not numeric`.

Neither changes the seed results (still 0 errors, 1 warning; 14/14 fixtures).

## Deferred, with reason

- **`catalogVersion` on documents** lands in Phase 2 with `bind_hardware`,
  since nothing binds a node yet. Phase 1 provides what it needs:
  `CatalogLoader.get(version)` loads any published version.
- **Glyph SVGs are not in the bundle yet.** The brief's bundle is entries +
  optics; Phase 4 adds sanitized glyphs when the renderer needs them (the
  version hash changes then, as intended).
- **`describe_capabilities`** is untouched until the Phase 3 tools exist.

## Verification

| Claim                                                       | How it was verified                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python tools pass before any change (0 errors / 14/14)      | Ran on the untouched package                                                                                                                                                                     |
| Python tools still pass after the move + fixes              | Ran on `catalog/`                                                                                                                                                                                |
| TS `resolveInterface` matches Python on all seed models     | 365 probes (every row; members 1, 2, max, max+1; member 0, leading zero, trailing newline, case, suffix, empty) in `fixtures/resolve/golden.json`: 365/365 equal (`src/catalog/catalog.test.ts`) |
| TS checker matches `check_seed.py`                          | Identical output on the seed; broken-copy tests for schema, cross-refs, panel bounds, SVG anchors (incl. missing coordinate), optics, duplicate ids (`src/catalog/build.test.ts`)                |
| Bundle hash is content-only and published bundle is current | `build.test.ts` (key order / file order invariance, content change → new hash, published file byte-equal)                                                                                        |
| Worker loads bundles through ASSETS                         | `src/testing/worker-catalog.test.ts` (Miniflare with a real ASSETS binding over `public/`)                                                                                                       |
| `/catalog/*` is not public                                  | `src/testing/default-handler.test.ts` (three spellings, body proves ASSETS was never asked)                                                                                                      |
| Vite build ships the bundle                                 | `npm run build` → `dist/catalog/`                                                                                                                                                                |

Not verified by observation: nothing in Phase 1 is user-visible; no deploy
was made.
