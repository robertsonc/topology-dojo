# Topology Dojo — Production Launch QA Test Plan

> **Historical pre-launch snapshot (2026-07-04), superseded by the live
> production system.** Several items this plan names as "out of scope for
> launch" (in-GUI layout badges, the legacy importer) have since shipped; the
> deploy mechanism it describes (`npx wrangler deploy`) has since been
> replaced by a gated pipeline. For current status, see
> [`../ROADMAP.md`](../ROADMAP.md) and
> [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md). Preserved as a record
> of the original launch-readiness bar, not as current guidance.

**Version:** 1.0 · **Date:** 2026-07-04 · **Target launch:** T+30 days
**System under test:** Topology Dojo — canvas topology editor + headless API + MCP server, deployed as a Cloudflare Worker (Durable Object MCP sessions, GitHub OAuth 2.1, KV-backed share links)

---

## 1. Scope & Risk-Based Priorities

### 1.1 In scope

| Area             | Surface                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canvas editor    | `src/editor` — selection, drag, marquee, guides, links/waypoints, anchors, undo/redo, Tidy, arrange, legend, stencil, clone, captions, find (Ctrl+F), minimap, context menu, select-by           |
| Flipbook / pages | `src/pages` — page model, filmstrip, duplicate (deep copy), playback timing, autosave to localStorage                                                                                            |
| Node Designer    | `src/nodes` — CustomNodeSpec authoring, pure interpreter render, catalog integration                                                                                                             |
| Headless API     | `src/api` — builder, edit/upsert, validate + layout analyzer, catalog parity, tidy, layouts, templates, layers, markers                                                                          |
| MCP server       | `src/mcp` + `worker/mcp.ts` — all ~40 tools, stdio and remote Streamable HTTP at `/mcp`                                                                                                          |
| Worker & routing | `worker/` — static app serving, `/api/topology/<id>`, `/v/<id>` shared views, OAuth endpoints                                                                                                    |
| Auth             | GitHub OAuth 2.1 for MCP (`/authorize`, `/token`, `/register`, `/callback`, `/.well-known/oauth-authorization-server`) and browser session flow (`/login`, `/auth/github`, `/logout`, `/api/me`) |
| Share links      | `share_topology` → KV snapshot → `/v/<id>` (30-day expiry)                                                                                                                                       |

### 1.2 Out of scope (explicitly)

- `src/core` (retired beat model — dormant, no runtime path).
- Editing/auditing the vendored engine internals (`public/vendor/`) beyond its rendered output.
- Live-data connector tools (`list_appliances`, `list_flows`, `build_flow_topology`, …) against a **real** EdgeConnect Orchestrator — tested against `TOPOLOGY_PROVIDER=mock` only, unless a fabric sandbox is provisioned before T+20. Real-fabric integration is a launch-blocker _only if_ live-data ships enabled in prod.
- Tween/morph animation of custom nodes (excluded by design — locked decision #1).

### 1.3 Risk ranking (drives test-effort allocation)

| P   | Risk                                                                                                                                                                                        | Why                                                        | Mitigating suites |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| P0  | **Data loss** — autosave failure, quota exceeded silently swallowed (`persist.ts` catches quota errors as "non-fatal"), destructive undo/redo bugs, `duplicatePage` shallow-copy regression | Users lose work; trust-killer at launch                    | F2, N2            |
| P0  | **Auth bypass / gating holes** — SPA is gated by GitHub session; `/v/<id>` is deliberately ungated; `/mcp` gated by OAuth 2.1                                                               | Security incident on day 1                                 | F6, F7            |
| P0  | **MCP correctness on the Worker** — per-owner isolation, canonical document-coordinator concurrency, tool parity with stdio, renderer parity (bundled vs `createRequire`)                   | The agent story is the product's differentiator            | F8, N3            |
| P1  | **Share-link integrity** — KV snapshot fidelity, expiry, `/api/topology/<id>` fetch, custom nodes surviving the round trip                                                                  | Primary "hand a result to a human" path                    | F5                |
| P1  | **Render parity** — same document must render identically in browser, Node (`server/render.ts`), and Worker (`worker/render.ts`); `calm`/reducedMotion threaded through both                | "Same look whether human or LLM drew it" is the north star | F4, F8, R2        |
| P1  | **Catalog parity** — palette/inspector/validation/MCP all derive from `api/catalog.ts`; drift = UI-only surfaces (violates locked decision #3)                                              | Enforced by parity test; verify it actually gates CI       | R1                |
| P2  | Editor interaction polish — guides, snap, waypoints, minimap, select-by                                                                                                                     | Degrades UX, rarely corrupts data                          | F1                |
| P2  | Large-document performance                                                                                                                                                                  | Agents generate big docs; 200-node canvas must stay usable | N1                |
| P3  | Theming (light/dark/calm), status bar, cosmetic                                                                                                                                             | Low blast radius                                           | F1 smoke          |

---

## 2. Test Environments & Matrix

### 2.1 Environments

| Env                | Purpose                                                                                                              | Notes                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Local dev**      | `npm run dev` (Vite, `http://localhost:5173`) + `npm run mcp` (stdio)                                                | No auth, no KV — share_topology **not registered** here (verify it's absent, not broken)                                             |
| **Local worker**   | `wrangler dev` with local KV/DO simulation                                                                           | OAuth against a dev GitHub OAuth App; verify DO migration applied via `wrangler deploy` (never `versions upload` — error 10211)      |
| **Staging worker** | Stable, fully deployed Worker + own `OAUTH_KV` / `TOPOLOGY_KV`, DO namespaces, and staging GitHub OAuth App/callback | Canonical preview surface; full `wrangler deploy --env staging`, never production `versions upload`; all F5–F8 and N suites run here |
| **Production**     | Post-deploy smoke only (read-only + throwaway topology IDs)                                                          | Verify `PUBLIC_BASE_URL` yields absolute `/v/<id>` links                                                                             |

### 2.2 Browser / viewport matrix

| Browser | Versions         | Priority                                                                                                |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| Chrome  | latest, latest-1 | P0 (full suite)                                                                                         |
| Firefox | latest           | P0 (full editor suite)                                                                                  |
| Safari  | latest (macOS)   | P1 (editor + share view; watch SVG rendering, `structuredClone`, localStorage behavior in private mode) |
| Edge    | latest           | P2 (smoke)                                                                                              |

Viewports: 1920×1080 (primary), 1440×900, 1280×720 (minimum supported — filmstrip + inspector + minimap must not collide). Tablet/mobile: `/v/<id>` shared **view** must be readable at 768×1024 (pan/zoom); full editing on touch is **not** a launch requirement — document as known limitation.

### 2.3 MCP client matrix

| Client                            | Transport                                                             | Priority                                |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| Claude Code / Claude Desktop      | stdio (`npm run mcp`)                                                 | P0                                      |
| Claude connector → staging `/mcp` | Streamable HTTP + OAuth (dynamic client registration via `/register`) | P0                                      |
| MCP Inspector                     | both                                                                  | P1 (protocol conformance, error shapes) |

---

## 3. Functional Test Suites

Conventions: each case = **ID / Steps / Expected**. "Fresh doc" = new document, 1 empty page.

### F1 — Editor Canvas Operations

| ID    | Steps                                                                                | Expected                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1-01 | Drag node type from palette onto canvas                                              | Node appears at drop point, snapped to grid; document JSON gains the node; status bar updates                                                       |
| F1-02 | Click node → drag                                                                    | Node follows pointer; smart alignment + spacing guides appear against neighbors; release commits position to model                                  |
| F1-03 | Marquee-select 3 of 5 nodes; drag group                                              | Only the 3 move, relative offsets preserved                                                                                                         |
| F1-04 | Hold Space + drag on empty canvas                                                    | Canvas pans; no selection change; no document mutation (pan is a sanctioned human-only surface)                                                     |
| F1-05 | Create link between two nodes; drag mid-link to add waypoint; drag waypoint          | Link bends through waypoint; waypoint persists in document JSON and survives export/import                                                          |
| F1-06 | Anchor tool: place free-floating anchor; link node→anchor                            | Link terminates at anchor; anchor appears in page `anchors[]`                                                                                       |
| F1-07 | Undo (Ctrl+Z) ×5 after F1-01…F1-06; Redo ×5                                          | Each op reversed/replayed exactly; final state byte-identical document JSON to pre-undo                                                             |
| F1-08 | Select-by: type, then color, then "connected", then invert                           | Each mode selects the correct element set on a 10-node mixed page                                                                                   |
| F1-09 | Ctrl+F, type a node name, Enter                                                      | Viewport jumps to and highlights the matching element                                                                                               |
| F1-10 | Right-click node                                                                     | Context menu with element-appropriate actions; actions match toolbar equivalents                                                                    |
| F1-11 | Select 4 misaligned nodes → Align left, then Distribute horizontally                 | Positions align/distribute; single undo step reverts each operation                                                                                 |
| F1-12 | Deliberately overlap 6 nodes → press **T** (Tidy)                                    | Nodes grid-snapped, de-overlapped, in-bounds; zones auto-resize around members; result identical to `tidy_topology` on the same JSON (parity check) |
| F1-13 | Arrange… dropdown: hierarchical, grid, circular, force on same 12-node doc           | Each produces a valid layout with zero overlap warnings from `validate`; deterministic for hierarchical/grid/circular                               |
| F1-14 | Toggle dark theme, then calm-canvas                                                  | Theme applies to canvas + chrome; calm sets reducedMotion (no link-flow animation); toggles persist across reload                                   |
| F1-15 | Minimap: click a far region; drag viewport indicator                                 | Main viewport pans accordingly; minimap reflects all elements on large page                                                                         |
| F1-16 | Inspector: select link, change type via enum dropdown; set `flowSpeed`/`reverseFlow` | Fields offered match catalog exactly; render updates live; values round-trip through export                                                         |
| F1-17 | Set node `opacity` to 0.5 via inspector                                              | Node renders translucent with depth-of-field blur (<0.9 behavior); value in document JSON                                                           |
| F1-18 | Add zone from current multi-node selection; drag a member node out then back         | Zone created around selection; membership/geometry behaves per zone rules; validate flags zones swallowing non-members                              |
| F1-19 | Legend: enable via legend control, reposition                                        | Auto-generated symbol key reflects only types present on page; position persisted; matches `set_legend` MCP behavior                                |
| F1-20 | Clone selection (editor clone op)                                                    | Deep copy with fresh IDs; no shared references (mutate clone → original untouched)                                                                  |

### F2 — Pages / Flipbook & Persistence

| ID    | Steps                                                                                        | Expected                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F2-01 | Add 3 pages via filmstrip; reorder; rename page 2                                            | Order and names persist in document; filmstrip thumbnails correct                                                    |
| F2-02 | Duplicate a page with nodes+links+zones+custom nodes; edit the copy (move node, delete link) | **Original page unchanged** (deep `structuredClone`, fresh IDs). This is the flipbook's core invariant — automate it |
| F2-03 | Set per-page durations; press Play                                                           | Pages flip on schedule per `playback.ts`; loop/stop behavior correct; calm mode respected                            |
| F2-04 | Edit doc, wait for autosave, hard-reload browser                                             | Document restored from localStorage exactly, including current page, custom nodes, layers                            |
| F2-05 | Corrupt the localStorage value by hand; reload                                               | Defensive parse: app starts with a clean document, no crash, no white screen                                         |
| F2-06 | Export document JSON; re-import into fresh session                                           | Byte-equivalent semantics: pages, elements, customNodes, layers, palette, legend all restored; `validate` clean      |
| F2-07 | Delete the last remaining page                                                               | App either prevents it or recreates an empty page — never a zero-page document (render would crash)                  |

### F3 — Node Designer & Custom Node Types

| ID    | Steps                                                                                | Expected                                                                                                      |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| F3-01 | Open Node Designer; build custom type from shapes/icons; save                        | Type appears in palette **with live art preview**; spec stored as data in `customNodes[]` (no generated code) |
| F3-02 | Place custom node; export doc; import into new session                               | Custom node renders identically (pure interpreter `renderCustomNode`); no missing-type error                  |
| F3-03 | `describe_capabilities` with `topologyId` of a doc containing custom types (via MCP) | Custom types listed alongside builtins with their fields — catalog covers them                                |
| F3-04 | Define custom type with same name as a builtin                                       | Merged-over-defaults behavior per `define_node_type`; no silent clobber of builtin across other documents     |
| F3-05 | Render a page with a custom node headlessly (`render_svg` on worker AND stdio)       | SVG identical (modulo IDs) to browser render — three-runtime parity for the interpreter                       |
| F3-06 | Edit an existing custom type used on 3 pages                                         | All instances re-render with new art; undo restores prior spec                                                |

### F4 — Import / Export & Rendering

| ID    | Steps                                                                  | Expected                                                                                                                           |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| F4-01 | Editor export SVG of current page                                      | Standalone SVG opens in browser/Inkscape; fonts/theme embedded; matches canvas                                                     |
| F4-02 | `export_flipbook` (MCP) on 5-page doc with durations                   | Self-contained HTML plays all pages on their durations, no external asset fetches, works offline                                   |
| F4-03 | Import malformed JSON (truncated, wrong shape, unknown element type)   | Loud, specific error at import time; document unchanged — "fail loud at author time"                                               |
| F4-04 | Import a doc with dangling link endpoint + duplicate IDs; run validate | `validate` lists dangling reference and duplicate-id problems; render still succeeds (warnings never block)                        |
| F4-05 | Render with `visibleLayers` filtering (underlay hidden)                | Hidden-layer elements absent from SVG; untagged base layer always shown; a layer with default-hidden stays hidden unless requested |
| F4-06 | Re-render same page 3× (engine trailing-empty-Step trick)              | No entrance-animation replay; identical SVG each time                                                                              |

### F5 — Share Links

| ID    | Steps                                                                   | Expected                                                                                                                          |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| F5-01 | Via remote MCP: build doc → `share_topology`                            | Returns `<PUBLIC_BASE_URL>/v/<id>` (absolute in staging/prod); snapshot in `TOPOLOGY_KV`                                          |
| F5-02 | Open `/v/<id>` in a browser **with no session cookie**                  | Loads the snapshot into the editor via `/api/topology/<id>` — **no redirect to `/login`** (shared views are deliberately ungated) |
| F5-03 | Open `/v/<id>` after the MCP session/DO that created it is gone         | Still loads (KV outlives session) — the whole point of share vs `get_topology`                                                    |
| F5-04 | Share a doc with custom nodes, layers, palette, legend, 10 pages        | `/v/<id>` view is pixel-faithful to the author's canvas across the browser matrix                                                 |
| F5-05 | `GET /api/topology/<nonexistent-id>` and `/v/<nonexistent-id>`          | Clean 404 / friendly "not found or expired" page — no stack trace, no login redirect loop                                         |
| F5-06 | Expiry: create snapshot with TTL shortened in staging; wait past expiry | Link returns the expired/not-found experience; re-publishing the same doc issues a working new link                               |
| F5-07 | Mutate the source doc after sharing; reload `/v/<id>`                   | Snapshot is immutable — shows the state at share time                                                                             |
| F5-08 | ID probing: request 20 random `/v/<id>` values                          | All 404; IDs non-sequential/unguessable (check generation entropy)                                                                |
| F5-09 | `share_topology` on **stdio** server                                    | Tool is **not registered** (remote-only); tool list omits it; no crash                                                            |

### F6 — Auth: Browser Session Flow

| ID    | Steps                                                                                 | Expected                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| F6-01 | Visit `/` with no session                                                             | Redirect to `/login?go=%2F`; branded GitHub sign-in page renders (self-contained — loads even though app assets are gated)              |
| F6-02 | Complete `/auth/github` → GitHub → `/callback?state=web…`                             | State nonce validated; session cookie set (HttpOnly/Secure/SameSite — inspect); redirected to original `go` path including query string |
| F6-03 | `/api/me` with and without session                                                    | 200 `{login, name}` vs 401                                                                                                              |
| F6-04 | `/logout`                                                                             | Cookie cleared; back at `/login`; back-button does not restore an authenticated app view that can fetch                                 |
| F6-05 | Tamper with `state` param on `/callback`                                              | Rejected; no session set; clear error                                                                                                   |
| F6-06 | Deep-link `/some/path?x=1` while logged out; then log in                              | Land on `/some/path?x=1` (the `go` round trip)                                                                                          |
| F6-07 | GitHub token exchange fails (revoke staging client secret temporarily)                | User-visible failure page, error logged ("web login: token exchange failed") — not a blank 500                                          |
| F6-08 | Confirm `/callback` disambiguation: run browser login and MCP OAuth flow back-to-back | Each `/callback` request routed to the correct flow (web-state prefix vs provider); neither breaks the other                            |

### F7 — Auth: MCP OAuth 2.1

| ID    | Steps                                                         | Expected                                                                                                 |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| F7-01 | `GET /.well-known/oauth-authorization-server`                 | Valid discovery doc pointing at `/authorize`, `/token`, `/register`                                      |
| F7-02 | Connect Claude to staging `/mcp` from scratch                 | Dynamic client registration → single GitHub authorize click → tools listed; no manual token paste        |
| F7-03 | Call `/mcp` with no token / expired token / garbage Bearer    | 401 with proper `WWW-Authenticate`; never a tool response                                                |
| F7-04 | Verify authenticated identity                                 | Tool context (`this.props`) reflects the GitHub user who authorized; grants/tokens present in `OAUTH_KV` |
| F7-05 | Revoke/expire grant in `OAUTH_KV`; call a tool                | Client is driven back through re-auth, not a hang                                                        |
| F7-06 | Unauthenticated user hits `/authorize` (MCP consent) directly | Sane behavior — sent through GitHub, no open redirect (fuzz `redirect_uri` against registered client)    |

### F8 — MCP Tools (stdio + remote — run the full table on both; parity is the assertion)

| ID    | Steps                                                                                                                                               | Expected                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F8-01 | `describe_capabilities` (no args)                                                                                                                   | Every builtin node/link/annotation type with fields, enums, animation flags, id-reference kinds — diff against `api/catalog.ts`                                          |
| F8-02 | Golden agent loop: `create_topology` → `layout_guidelines` → `add_node`×5 → `add_link`×4 → `validate_topology` → `tidy_topology` → `render_svg`     | Each step succeeds; final validate has no overlap warnings; SVG contains all 5 nodes. **This is the launch-blocking E2E**                                                |
| F8-03 | `list_templates` → `create_from_template` for **every** template                                                                                    | Each instantiates, validates clean, renders                                                                                                                              |
| F8-04 | Page targeting: `add_page` ×2, then `add_node` with no `pageIndex`, then with `pageIndex: 0`                                                        | Default targets most-recently-added page; explicit index respected; `render_svg` defaults to page 0                                                                      |
| F8-05 | `update_element` on node/link/zone (position, label, enum field); `remove_element` on a node with links + zone membership                           | Patch applies in place; remove cascades (dependent links/memberships cleaned, verified via `get_topology`)                                                               |
| F8-06 | `upsert_by_source` twice with same `system/kind/id`, changed fields                                                                                 | First call creates, second converges the same element (idempotent — no duplicate)                                                                                        |
| F8-07 | `get_topology` → `delete_topology` → `import_topology` (the exported JSON)                                                                          | Full round trip; re-imported doc validates clean and renders identically                                                                                                 |
| F8-08 | Invalid input fuzz: unknown node type, out-of-range enum, bad `topologyId`, missing required arg, `pageIndex: 99`                                   | Every case → structured MCP `isError` with actionable message; DO/session still alive for the next call                                                                  |
| F8-09 | `define_layer` (policy, opacity 0.4, default-hidden) + tagged elements; `render_svg` with/without `visibleLayers`                                   | Z-order = declaration order; opacity dims plane; hidden-by-default honored; geometry untouched                                                                           |
| F8-10 | `set_palette` (brand hex), `set_legend`, `set_node_metadata`, `set_document_title`, `set_page_properties`                                           | Each reflected in `get_topology` JSON and in rendered SVG; `set_palette` `clear` resets                                                                                  |
| F8-11 | `layout_topology` all four algorithms on an unplaced 20-node doc; `balance_topology` after                                                          | Valid overlap-free layouts; balance aligns rows/cols + centers; deterministic where specified                                                                            |
| F8-12 | `add_zone`, `add_flow_path`, `add_policy_marker` (incl. per-marker `icon` override)                                                                 | Annotation layer authored headlessly renders identically to editor-authored equivalents                                                                                  |
| F8-13 | Owner sharing/isolation (remote): two MCP sessions for the same GitHub owner create drafts; a different owner lists                                 | Same owner sees both durable drafts across sessions; different owner sees neither                                                                                        |
| F8-14 | Session lifecycle (remote): create draft, idle past MCP DO eviction, reconnect                                                                      | Per-owner registry rehydrates it; document survives transport/session turnover                                                                                           |
| F8-15 | Live-data (mock provider, `TOPOLOGY_PROVIDER=mock`): `describe_data_source`, `list_appliances`, `list_tunnels`, `list_flows`, `build_flow_topology` | Tools registered only when provider wired; `build_flow_topology` yields layered, tidy, valid doc from fixtures; with no provider configured, tools absent from tool list |
| F8-16 | Attempt to pass credentials through live-data tool arguments                                                                                        | No tool accepts credential args (env/secrets only — verify schemas)                                                                                                      |
| F8-17 | Build a private draft, call `get_workspace_manifest` with its id, then access it from the browser Agent Workspace list                              | Lazy migration initializes once; legacy snapshot remains; subsequent legacy mutation returns guidance to use workspace tools                                             |
| F8-18 | At revision N, edit 20 unrelated elements in the UI; call `get_workspace_changes` from N, then `get_workspace_elements` for two affected ids        | Summary is bounded and contains no full document; targeted read returns only requested/paginated elements                                                                |
| F8-19 | Agent calls `propose_workspace_changes` without a lease; browser inspects and accepts                                                               | Canonical revision is unchanged before acceptance; UI shows semantic detail; acceptance creates exactly one revision                                                     |
| F8-20 | Agent calls `apply_workspace_changes` without lease, then with a UI-granted ten-minute current-page lease; try a second page and retry after expiry | No-lease, out-of-scope, and expired calls fail explicitly; in-scope call commits; agent cannot grant/extend the lease                                                    |
| F8-21 | UI and agent start at the same revision: patch different fields, then repeat on the same field; test delete versus edit                             | Disjoint fields rebase into consecutive revisions; same-field and delete/edit produce conflicts with no silent winner                                                    |
| F8-22 | Hand off a generated document >2 MiB aggregate with 20 sub-1.8 MiB pages; then try one page >1.8 MiB                                                | Aggregate document succeeds through per-page keys; oversize page fails visibly without advancing revision                                                                |

---

## 4. Regression Strategy

1. **CI gate (every PR, already exists — verify and extend):** `npm test` (Vitest — the suites in `src/api/*.test.ts`, `src/mcp/tools.test.ts`, `src/mcp/persist-store.test.ts`, `src/pages/*.test.ts`, `src/editor/*.test.ts`, `src/nodes/*.test.ts`), `npm run lint`, `npm run build` (typechecks app **and** worker). The **catalog parity test** is the keystone regression — confirm it actually fails the build when a vocabulary entry is added without catalog coverage (mutation-test it once, manually).
2. **Golden-SVG snapshots:** add a small corpus (5–10 documents covering builtins, custom nodes, layers, annotations, palette) rendered via `server/render.ts` in CI, snapshot-diffed. Any vendored-engine or render-core change lights up visually. Extend the same corpus to the Worker renderer in staging to catch bundled-vs-`createRequire` divergence.
3. **Automated E2E (Playwright), nightly against staging:** F8-02 golden agent loop over HTTP `/mcp` (with a pre-provisioned OAuth token), F8-17→F8-21 shared-workspace loop, F5-01→F5-02 share-link loop, F6-01/02 login loop, F2-02 duplicate-page invariant, F2-04 autosave reload. Keep the smoke subset small and run the full concurrency matrix separately.
4. **Manual regression pack:** the P0/P1 rows of F1–F8, executed on release candidates and after any change to `worker/`, `src/vendor`, `public/vendor`, or `src/mcp/register.ts`. Time-boxed to 1 day for two testers.
5. **Change-risk map:** any diff touching `public/vendor/` or the three sanctioned engine patches (marker `icon`, link flow controls, node `opacity`) triggers the golden-SVG suite + F1-16/F1-17 manually; any diff to `wrangler.jsonc` or DO migrations triggers a full isolated staging deploy with F7 + F8-13/14, recorded SHA, smoke evidence, and a forward-recovery exercise before merge. Follow [`../DEPLOYMENT_RUNBOOK.md`](../DEPLOYMENT_RUNBOOK.md); use `wrangler deploy --env staging`, never a production `versions upload`.

---

## 5. Non-Functional Tests

### N1 — Performance with large documents

Target document: **200 nodes / 300 links / 20 pages / 10 zones / 5 custom node types** (generate via a headless-API script — reuse for all N1 cases).

| ID    | Test                                                                          | Threshold (proposal — ratify with PM at T+5)                                                    |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| N1-01 | Load 200-node/20-page doc into editor (import)                                | Interactive < 3 s on mid-tier laptop; no frozen tab                                             |
| N1-02 | Drag one node on the 200-node page                                            | ≥ 30 fps sustained; guides don't degrade it below 20 fps                                        |
| N1-03 | Marquee-select all 200; group-drag                                            | Completes without frame lockups > 250 ms                                                        |
| N1-04 | Undo/redo across 100 sequential edits                                         | Each step < 100 ms; memory does not grow unbounded (heap snapshot before/after)                 |
| N1-05 | `tidy_topology` / `layout_topology(force)` on 200 nodes via MCP on the Worker | Completes within Worker CPU limits — **no DO wall-clock/CPU kill**; measure and record headroom |
| N1-06 | `render_svg` of the 200-node page (Node + Worker)                             | < 2 s; SVG size sane (< 5 MB)                                                                   |
| N1-07 | `export_flipbook` of all 20 pages                                             | Output HTML < 20 MB; opens and plays smoothly                                                   |
| N1-08 | Filmstrip + minimap with 20 pages / 200 nodes                                 | Thumbnails render without blocking main thread                                                  |

### N2 — Persistence & quota

| ID    | Test                                                                                    | Expected                                                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N2-01 | Grow the autosaved doc toward the ~5 MB localStorage quota (script large label strings) | **Known gap to fix before launch:** `persist.ts` currently swallows quota errors silently. Requirement: on quota failure the user is warned (status bar/toast) and prompted to export JSON. Test the warning; file a P0 defect if still silent |
| N2-02 | Autosave under rapid edit bursts (drag storm)                                           | Debounced; no dropped final state; last edit always persisted on reload                                                                                                                                                                        |
| N2-03 | Safari private mode / storage disabled                                                  | App runs; degraded-persistence messaging; no crash loop                                                                                                                                                                                        |
| N2-04 | Inject a Durable Object page/meta/change write failure during a workspace commit        | Request fails visibly; revision and canonical snapshot remain unchanged; retry with the same operation id is safe                                                                                                                              |
| N2-04 | KV snapshot of the N1 mega-doc via `share_topology`                                     | Within Cloudflare KV value limit (25 MB) — measure; if a doc can exceed it, error must be user-actionable                                                                                                                                      |

### N3 — Concurrency & availability

| ID    | Test                                                                                                | Expected                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| N3-01 | 25 concurrent MCP sessions each running the F8-02 loop against staging `/mcp` (scripted MCP client) | All succeed; per-owner sharing and cross-owner isolation hold; p95 tool latency < 2 s (render < 5 s) |
| N3-02 | One session issuing 50 rapid sequential tool calls                                                  | In-order, no dropped/duplicated mutations (final `get_topology` matches expected state)              |
| N3-03 | 100 concurrent anonymous readers of one `/v/<id>`                                                   | All 200 OK; KV read path scales (it should — verify no per-request DO involvement)                   |
| N3-04 | OAuth burst: 10 simultaneous new-client registrations at `/register`                                | All issued; `OAUTH_KV` consistent                                                                    |
| N3-05 | Kill/redeploy the Worker mid-session                                                                | Reconnecting client gets clean re-init (per F8-14 semantics), not corrupted state                    |

### N4 — Security (minimum bar; schedule a focused pass at T+15)

- XSS via document content: node labels / page names / metadata containing `<script>`, `"><img onerror=…` must render inert in the editor, in `/v/<id>`, in exported SVG, and in `export_flipbook` HTML (the flipbook is self-contained HTML — highest injection risk).
- `import_topology` and `/api/topology/<id>` payload fuzzing (prototype-pollution keys like `__proto__`, deeply nested objects, 50 MB bodies).
- Cookie flags, open-redirect on `go=` param (`/login?go=https://evil.example` must not redirect off-origin), CSRF posture on `/logout`.

---

## 6. Entry / Exit Criteria

### Entry (per test cycle)

- Build green: `npm run build` (app + worker typecheck), `npm test`, `npm run lint`.
- Staging deployed via `wrangler deploy --env staging` with DO migration applied; isolated `OAUTH_KV`, `TOPOLOGY_KV`, `GITHUB_CLIENT_SECRET`, `PUBLIC_BASE_URL`, OAuth App, and DO namespaces configured and smoke-verified (F6-01, F7-01 pass). Deployment evidence identifies the exact source SHA.
- Test data pack available: golden-SVG corpus + N1 mega-doc generator script.

### Exit (launch go/no-go at T+27)

- 100% of P0 cases executed and passing on Chrome + Firefox + remote MCP; ≥ 95% of P1 executed, all failures triaged.
- Zero open Sev-1/Sev-2 defects; Sev-3s have documented workarounds and PM sign-off.
- N1 thresholds met or formally waived; N2-01 (quota warning) resolved — this specific item is a named launch blocker.
- Golden agent loop (F8-02) green in nightly E2E for 5 consecutive nights.
- Known-constraint behaviors (DO session volatility F8-14, no touch editing, 30-day link expiry) documented in user-facing docs.

## 7. Defect Triage & SLAs

| Sev   | Definition (examples from this app)                                                                                                                                   | Response                 | Fix target         | Launch gate   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------ | ------------- |
| Sev-1 | Data loss (autosave/undo corruption, shallow page duplicate), auth bypass (`/mcp` or SPA reachable unauthenticated), XSS in `/v/<id>` or flipbook export, Worker down | Triage same business day | 48 h               | Blocks        |
| Sev-2 | A P0/P1 feature broken with no workaround: share link 404s for valid snapshots, an MCP tool errors on valid input, render divergence between runtimes, login loop     | 1 business day           | 5 days             | Blocks        |
| Sev-3 | Broken with workaround / degraded: guides misalign, minimap stale, a layout algorithm produces overlaps that Tidy fixes, perf misses threshold < 2×                   | 2 business days          | Next patch release | PM discretion |
| Sev-4 | Cosmetic/polish: theme glitches, copy, status-bar staleness                                                                                                           | Weekly triage            | Backlog            | Never blocks  |

Process: all defects filed as GitHub issues with `sev-*` + area labels (`editor`, `mcp`, `worker`, `auth`, `share`, `render`); daily 15-min triage from T+20; any Sev-1/2 found after code freeze (T+25) triggers explicit go/no-go review; every Sev-1/2 fix must land with a regression test (unit in the matching `*.test.ts`, or an E2E scenario) before the issue closes.
