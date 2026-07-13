# Topology Dojo — Production Readiness Review (Findings Register)

_Adversarial agentic review, 2026-07-04. 51 findings confirmed by independent verification agents (2 candidate findings refuted and dropped)._

**Confirmed:** 4 critical · 9 high · 29 medium · 9 low

## CRITICAL (4)

### C1. Malformed page viewBox turns every node coordinate into NaN in tidy/layout/balance — persisted data destruction

- **Area:** Headless API | **Location:** `src/api/layout.ts:229` | **Type:** data-corruption
- **Problem:** parseViewBox uses `?? ` against Number() results, but NaN is not nullish, so a malformed viewBox yields NaN width/height. tidyPage's clampNode then computes a NaN fallback center and assigns it to every node; Math.round(NaN) is NaN. Reproduced: create page with viewBox '0 0 800px 600px' (accepted verbatim by the MCP tools set_page_properties/add_page, which take z.string() with no format check, and by parseDoc on import), add two nodes, call tidy_topology → all node x/y become NaN. The mutation is in place and persistAfter writes it to Durable Object storage, so the user's hand-placed coordinates are irrecoverably destroyed. Neither validateDocument nor analyzeLayout ever inspects viewBox, and NaN coordinates pass validation (see separate finding), so nothing flags the corruption. A '0 0 0 0' viewBox similarly piles all nodes at (0,0).
- **Fix:** Make parseViewBox reject non-finite/non-positive width/height (fall back to defaults per component: `Number.isFinite(p[2]) && p[2] > 0 ? p[2] : 1050`). Additionally validate the viewBox format in set_page_properties/add_page (regex or 4-finite-numbers parse) and flag malformed viewBox in validateDocument.

### C2. Stored XSS: node/link `type` rendered unescaped into the inspector

- **Area:** Editor & Client | **Location:** `src/main.ts:1010` | **Type:** security
- **Problem:** typeRow() interpolates the selected element's `type` string into inspector HTML with no escaping (every other interpolation site uses esc(), this one does not). `node.type` is attacker-controlled: parseDoc() blind-casts page.nodes (src/pages/persist.ts:95 `nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : []`) so a crafted document loaded via a /v/<id> share link (published by anyone through the MCP share_topology tool), an opened JSON file, or a poisoned localStorage doc carries an arbitrary `type`. When the user clicks that node, renderInspector() does `inspector.innerHTML = html` with typeRow(node.type, ...) inside, and a payload such as type = '"><img src=x onerror=alert(document.cookie)>' executes in the OAuth-gated app origin (session cookies, /api/\* access). Same hole for link.type at line 1356.
- **Fix:** Escape `t` with esc() in both the value attribute and option text (and audit annoFieldControl enum options similarly). Better: have parseDoc validate node/link `type` against an id-safe pattern (e.g. /^[\w:-]+$/) so hostile strings never enter the model.

### C3. persistStore deletes every stored topology after any rehydrate failure — total session data loss

- **Area:** MCP Server | **Location:** `src/mcp/persist-store.ts:47` | **Type:** data-loss
- **Problem:** persistStore treats the in-memory registry as the source of truth and deletes any DO-storage key whose id is not currently in memory. In worker/mcp.ts, rehydrate() catches ALL errors and 'starts empty' (lines 82-89), and rehydrateStore silently skips any doc for which parseDoc returns null. So: DO hibernates -> cold start -> storage.list() has a transient error OR one stored doc fails/throws in parseDoc -> registry is empty -> the agent's next successful mutating call (e.g. create_topology, which an agent will naturally issue when it finds its topology 'unknown') runs persistStore, which permanently DELETES every tdoc: key. A single corrupted document (see the update_element finding — trivially producible via tool input) aborts the whole rehydrate loop because parseDoc's zone self-heal throws, converting one bad doc into loss of ALL of the session's topologies. There is no distinction between 'doc was removed by delete_topology' and 'doc failed to load'.
- **Fix:** Track deletions explicitly (delete the key inside store.remove / a tombstone set) instead of mirroring by set-difference; never delete keys that failed to load. If rehydrate fails, either fail tool registration or mark the store degraded and skip the delete pass in persistStore. In rehydrateStore, wrap parseDoc per-document so one corrupt doc cannot abort loading the rest, and keep (not skip) unparseable payloads under their key.

### C4. Stored XSS in shared topologies via unvalidated element color fields

- **Area:** Injection & Rendering | **Location:** `src/pages/persist.ts:95` | **Type:** xss
- **Problem:** Any authenticated GitHub user can publish a topology through the share_topology MCP tool; the snapshot is stored verbatim in KV and served publicly at /v/<id> (worker/default-handler.ts serveSnapshot, no auth). When a victim opens /v/<id>, main.ts fetches the JSON and runs it through parseDoc, which passes node/link/zone/marker/layer arrays straight through with `p.nodes as Page['nodes']` — it validates ids and enums but NEVER validates the `color` fields. Those colors are interpolated raw (no \_esc) into SVG attribute values by the vendored engine, then injected into the live DOM via `svg.innerHTML` in renderPageInto. A node color of `#000"/><image href=x onerror=alert(document.domain)/><rect fill="` breaks out of the `stroke="..."`/`fill="..."` attribute and injects an <image onerror> that executes on render (innerHTML-inserted SVG event handlers fire even though <script> would not). There is NO Content-Security-Policy header anywhere in the worker, so nothing blocks it. Result: attacker-published document → victim opens shared link → JS runs on the app origin, able to read the victim's saved documents in localStorage and act inside their authenticated editor session.
- **Fix:** Validate every color-typed field on import (reuse the existing hexColor() gate in persist.ts that already guards the palette) and drop/normalize anything that isn't a strict `#rgb`/`#rrggbb` (or a small allowlist of named tokens). Defense in depth: escape color values at the render sinks and add a strict CSP (script-src 'self'; no inline handlers) on all worker responses.

## HIGH (9)

### H1. layout_topology strands anchors and manual link waypoints — links route across the canvas to stale positions

- **Area:** Headless API | **Location:** `src/api/autolayout.ts:350` | **Type:** correctness
- **Problem:** tidy.ts's carryAttachments exists precisely because (its own comment) 'a pass that shifts nodes leaves ports detached and routes bending back through stale waypoints — stray lines across the canvas'. But layoutPage never carries attachments for the algorithm's wholesale node movement: it only calls tidyPage as a finisher, whose carryAttachments uses positions captured after the algorithm already ran, so it compensates only for the small tidy delta. Reproduced: page with node a(100,600), anchor 'port1'(108,592) used as a link endpoint, and a link with manual waypoint (500,620); after layoutPage(hierarchical/LR) the nodes move to (479,350)/(571,350) while the anchor stays at (108,592) and the waypoint at (500,620) — the anchor-endpointed link now spans the page detached from any node. Any MCP agent following the documented flow (add elements → layout_topology) on a page with anchors or waypoints produces a visually broken diagram.
- **Fix:** Capture orig node positions at the top of layoutPage and call carryAttachments(page, orig) after the algorithm (before/instead of relying on tidyPage's internal call), mirroring what tidyPage/balancePage already do.

### H2. Opening a share link silently destroys the user's locally autosaved document

- **Area:** Editor & Client | **Location:** `src/main.ts:311` | **Type:** data-loss
- **Problem:** Visiting /v/<id> fetches the shared snapshot and calls loadDoc(parsed), which ends in markDirty(); 400ms later saveLocal(doc) overwrites the single localStorage slot ('topology-dojo:doc') that held the user's own work. There is no confirmation, no backup slot, and history.replaceState drops the /v/ path so the overwrite is permanent. Scenario: a user with hours of un-downloaded work clicks a colleague's share link (e.g. from Slack) in the same browser — their document is irreversibly replaced by the shared one. The fetch is also unawaited relative to boot: the app becomes interactive on the localStorage doc first, then loadDoc clobbers whatever the user started editing mid-flight.
- **Fix:** Before adopting a shared doc, either prompt when the local doc is non-trivial, or preserve the existing doc under a backup key / multi-document store. At minimum, do not autosave a share-link doc over the local one until the user makes an edit after an explicit 'keep this' choice.

### H3. loadDoc drops layers/legend/stencils from the incoming document and leaks the previous document's values

- **Area:** Editor & Client | **Location:** `src/main.ts:289` | **Type:** state-management
- **Problem:** loadDoc() assigns only title, pages, customNodes and palette; doc.layers, doc.legend, and doc.stencils are neither copied from `next` nor cleared. Two concrete failures: (1) Open a saved JSON (or a /v/ share link) that contains layers/legend/stencils — they are silently discarded even though parseDoc parsed them, so a document with a legend or layer visibility settings loads without them; the debounced autosave then persists the truncated doc, making the loss permanent. (2) Click 'new' after working in a doc with stencils/layers — the old stencils and layers survive into the supposedly blank document and get merged into it on the next save (cross-document contamination). The only assignments to doc.layers/legend/stencils elsewhere are UI mutations (lines 1254, 1318, 1904), never a load path.
- **Fix:** In loadDoc, assign (or delete) every TopologyDocument field: doc.layers = next.layers; doc.legend = next.legend; doc.stencils = next.stencils — then rebuild the palette and re-render. Add a round-trip test: loadDoc(parseDoc(serializeDoc(d))) must equal d.

### H4. Autosave failure is swallowed and the UI still shows '✓ saved' (silent data loss on quota exceeded)

- **Area:** Editor & Client | **Location:** `src/pages/persist.ts:176` | **Type:** persistence
- **Problem:** saveLocal() catches QuotaExceededError (and any storage failure) and returns as if nothing happened; markDirty() in src/main.ts:212-219 then unconditionally sets savedEl.textContent = '✓ saved'. localStorage is the ONLY persistence in this app (no server save), so a document that grows past the ~5MB quota (many pages, large customNodes/stencils), or a browser in a storage-restricted mode, means every subsequent edit is lost on tab close while the user is actively told their work is saved. There is no retry, no warning, and no prompt to download.
- **Fix:** Make saveLocal return a boolean (or throw) and have markDirty display a persistent 'not saved — download your work' state on failure, ideally with a one-click JSON download. Consider IndexedDB for headroom.

### H5. update_element null-patch can delete required fields (zone.nodes), producing stored docs that crash parseDoc on rehydrate

- **Area:** MCP Server | **Location:** `src/api/edit.ts:100` | **Type:** input-validation
- **Problem:** updateElement's patch semantics delete any key set to null and accept arbitrary unknown values (the MCP tool's `set` is z.record(z.string(), z.unknown())). Calling update_element with { elementId: <zoneId>, set: { nodes: null } } (or nodes: "x") deletes/corrupts the zone's required nodes array. The mutation succeeds, persistAfter serializes it to DO storage, and on the next cold start parseDoc's zone self-heal loop (src/pages/persist.ts lines 111-116: `if (z.nodes.some(...))`) throws TypeError on the missing array — which, combined with the persistStore mirror-delete, wipes the whole session's storage. Even ignoring the wipe, a flowPath patched with { waypoints: null } makes remove_element (cascade) and render throw on that doc from then on. Bad tool input becomes permanent document/state corruption rather than a rejected call.
- **Fix:** Guard structurally required fields in updateElement (id is already protected; also protect nodes/waypoints/from/to/type/x/y from null-deletion or wrong types, per element kind). Defensively normalize zone.nodes (z.nodes ?? []) and other arrays in parseDoc so a malformed stored doc degrades instead of throwing.

### H6. Silent persistence failure for large documents: persistAfter swallows storage.put errors, so 'successful' topologies vanish on hibernation

- **Area:** MCP Server | **Location:** `worker/mcp.ts:101` | **Type:** data-loss
- **Problem:** persistStore writes each document as ONE storage value (storage.put(DOC_PREFIX+id, serializeDoc(doc))). Durable Object KV values are hard-capped (2 MB for SQLite-backed classes, which wrangler.jsonc configures via new_sqlite_classes), and serializeDoc pretty-prints with 2-space indentation, inflating size substantially. There is no size limit on import_topology (json: z.union([z.string(), z.record(...)]) — unbounded), on node meta maps, labels, or custom node specs, so a document can exceed the cap easily (a compiled fabric with per-flow hop data, or any import of a few MB). When put throws, persistAfter catches and only logs — the tool call returns success, the agent keeps editing, and after the DO hibernates the topology is gone or stale ('unknown topology'). This is silent, size-triggered data loss. Aggravating: persistStore rewrites EVERY document on EVERY mutating call (sequential awaited puts), so one oversized doc also fails persistence attempts triggered by edits to other docs after the delete pass has already run.
- **Fix:** Surface persistence failure to the caller (return isError so the agent knows the write is not durable), enforce a documented max document size at import/mutation time, serialize compactly (no pretty-print), and persist only the mutated document (chunk or move to R2/KV if docs can legitimately exceed the DO value cap).

### H7. Production deploy is not gated on CI: Workers Builds auto-deploys every push to main regardless of test results

- **Status (2026-07-13): Pipeline delivered and proven on staging; open pending
  production cutover.** The CI-gated Actions deploy path now exists —
  `deploy-production.yml` re-runs `ci.yml` (via `workflow_call` / `needs:
check`), requires the `production` GitHub environment approval, and is
  restricted to `main` with the CI `check` as a required status (Packet D5,
  PR #150; environments + branch protection, operator O5/O6). It was exercised
  end to end on staging by
  [Deploy Staging run #4](https://github.com/robertsonc/topology-dojo/actions/runs/29219841599)
  (SHA `104b4d5`). This finding stays **open** only because production still
  auto-deploys through Workers Builds: the residual cutover is operator O9
  (disconnect Workers Builds) followed by O10 (first gated production deploy).
  A Node 22 pin across all workflows (PR #155) resolved the CI/deploy toolchain
  mismatch this finding also flagged.

- **Area:** CI/CD & Release | **Location:** `.github/workflows/ci.yml:8` | **Type:** deploy-pipeline-safety
- **Problem:** The GitHub Actions workflow only runs checks; deployment happens through the Cloudflare Workers Builds Git integration, which triggers on push to main and runs its own build/deploy command ('npx wrangler deploy' per the repo's own docs) in parallel with — and independent of — CI. A commit whose vitest suite or lint fails but which still compiles ships straight to production at 100% traffic (no gradual rollout is possible because the DO migration forbids 'versions upload'). Worse, the artifact that reaches production is not the one CI built: Workers Builds rebuilds under its own default Node version while CI tests on Node 20 (there is no engines field or .nvmrc pinning). Direct pushes to main are clearly anticipated (the workflow has a push: main trigger), so nothing in the repo assumes branch protection either.
- **Fix:** Pick one gated path: either move deploy into GitHub Actions (cloudflare/wrangler-action with a CLOUDFLARE_API_TOKEN secret, in a job with `needs: check`, on push to main only) and disconnect Workers Builds auto-deploy, or set the Workers Builds build command to `npm ci && npm run typecheck && npm test && npm run lint && npm run build` so a red suite fails the deploy. Also add an engines/.nvmrc pin (node 20) so CI and the deploy build use the same toolchain, and enable branch protection requiring the CI check.

### H8. Custom node spec fields inject arbitrary SVG markup (typeName breaks out of <defs>/url())

- **Area:** Injection & Rendering | **Location:** `src/nodes/render.ts:44` | **Type:** xss
- **Problem:** parseDoc accepts `d.customNodes` with zero field validation (`d.customNodes as CustomNodeSpec[]`). renderCustomNode then interpolates several spec fields raw into markup that is registered with the engine and rendered into the DOM on the shared-view path (registerCustomNodes runs for the loaded doc, and any node using the type renders it). `spec.typeName` is placed inside a `<defs>` id and then inside `fill="url(#${pid})"`; a typeName like `x"/><image href=x onerror=alert(1) y="` closes the fill attribute and injects an active element. colorStroke/colorFill/ledColor/badgeColor are likewise interpolated into `stroke=`/`fill=` with no escaping (only badgeText is passed through esc). Same stored-XSS reach as the color finding: attacker defines a malicious custom type via MCP define_node_type, adds a node of that type, publishes, victim views /v/<id>.
- **Fix:** Validate CustomNodeSpec on import: enforce a safe charset for typeName (e.g. `^[A-Za-z0-9_-]+$`), validate all color fields as hex, and constrain enums (shape/pattern/icon/ledPos/portPos). Escape any field that reaches markup.

### H9. Status bar shows '✓ saved' even when autosave silently failed (quota/private mode), and there is no unload flush

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:215` | **Type:** error-feedback
- **Problem:** saveLocal() swallows all localStorage errors, but markDirty() unconditionally reports success after calling it. The document's only persistence is localStorage (there is no server save), so this is a false save indicator over real data loss. Failure scenario: user in Safari private browsing or with a quota-exceeded origin edits for an hour, watches '✓ saved' after every change, closes the tab -> everything is gone. Separately, the save is debounced 400ms and there is no beforeunload handler (grep finds none in src/), so closing the tab immediately after an edit drops the last change even when storage works.
- **Fix:** Make saveLocal return success/failure; on failure show a persistent 'not saved — download your work' warning instead of '✓ saved'. Add a beforeunload/pagehide handler that flushes the pending debounced save.

## MEDIUM (29)

### M1. parseDoc crashes with TypeError on plausible input and silently accepts null/garbage elements that break every later tool

- **Area:** Headless API | **Location:** `src/pages/persist.ts:112` | **Type:** validation-gap
- **Problem:** parseDoc's contract is 'a corrupt or hand-edited file must never crash — falls back to a valid shape or null', but element arrays are cast unchecked (`p.nodes as Page['nodes']`). Two reproduced failures: (1) a zone without a nodes array — {pages:[{zones:[{id:'z1'}]}]} — throws 'Cannot read properties of undefined (reading some)' in the self-heal loop, and a null entry in nodes throws 'Cannot read properties of null (reading id)', so import_topology surfaces a raw TypeError instead of 'invalid topology document JSON'; (2) a null entry in links passes parseDoc, the document is stored and persisted, and then validate_topology throws 'Cannot read properties of null (reading from)' — the tool advertised as the safety net crashes on the very document import accepted, and updateElement/removeElement/render crash the same way. The poisoned document is rehydrated from DO storage on every cold start.
- **Fix:** Normalize element arrays entry-by-entry in parseDoc: keep only object entries with a string id (defaulting zone.nodes to [], flowPath.waypoints to []), drop or reject the rest. At minimum wrap the self-heal loop defensively so parseDoc honors its return-null contract.

### M2. validateDocument accepts NaN/Infinity node coordinates — document validates clean but renders broken SVG

- **Area:** Headless API | **Location:** `src/api/validate.ts:121` | **Type:** validation-gap
- **Problem:** The only coordinate check is `typeof n.x !== 'number'`, and typeof NaN === 'number', so a node with x:NaN or y:Infinity produces zero errors (reproduced: 0 errors for x:NaN). analyzeLayout is also silent because every NaN comparison is false. Such values arrive via import_topology (parseDoc does not check element fields), via update_element set:{x:null} deleting x entirely, or via the viewBox corruption above. The 'valid' document then renders NaN into SVG coordinate attributes headlessly and in the GUI, and hit-testing/layout on it silently misbehaves — exactly the 'validates but crashes the renderer' class. Same gap for opacity (NaN passes the 0..1 range check) and anchor x/y, which are never type-checked at all.
- **Fix:** Use Number.isFinite(n.x) / Number.isFinite(n.y) (and the same for anchors, waypoint points, opacity, padding) so non-finite numerics are validation errors.

### M3. Convergent re-compile mints duplicate policy-marker ids when a flow's steering policy changes

- **Area:** Headless API | **Location:** `src/connect/compile.ts:322` | **Type:** id-collision
- **Problem:** compileFlow's policy marker uses source identity `policy|<policy.id>@<flowKey>` but explicit element id `elId('pm', flowKey)` — the id omits the policy. compileFabric is documented for in-place refresh ('Pass an existing compiled document to refresh it in place'); when the same flow is re-compiled after being steered into a different overlay, the source no longer matches, upsertBySource takes the create path, and addPolicyMarker appends a second marker with the identical id. Reproduced: two markers both id 'pm_A_f1', and validateDocument reports error 'duplicate policy marker id "pm_A_f1"' — the converged document violates the page-unique-id invariant that locate()/updateElement/removeElement rely on (they silently operate on the first match only). Relatedly, because compileFabric/compileFlow always pass `id:` in upsert props, converging onto an element that carries the same source but a different id (e.g. authored by hand or renamed) throws 'element id cannot be changed' (reproduced), aborting the refresh.
- **Fix:** Either include policy.id in the marker's element id, or (better) key the marker source by flowKey alone so a policy change updates the existing marker. In upsertBySource, ignore a props.id that differs from the matched element's id on the update path instead of throwing (or strip id before update in compile).

### M4. removeElement with an id that exists twice cascades-deletes links belonging to the surviving duplicate

- **Area:** Headless API | **Location:** `src/api/edit.ts:150` | **Type:** correctness
- **Problem:** None of the add\* builders (addNode/addLink/addZone/... and their MCP tools, which accept explicit nodeId/linkId/etc.) reject an id that already exists on the page — the uniqueness invariant edit.ts documents ('validate enforces this') is only checked by the optional validate_topology tool. locate() returns the first match, so with two nodes sharing id 'a': update_element patches only the first, and remove_element removes the first but its cascade prunes ALL links whose from/to === 'a', all markers with nodeId 'a', all zone memberships and flow-path waypoints 'a' — i.e. the edges of the still-present second node are silently destroyed along with the first node. An agent that reuses an id (a common LLM failure mode the API should be defensive about) gets no error at creation time and corrupted, partially-deleted topology later.
- **Fix:** Reject duplicate explicit ids at add time (throw 'id already exists on this page' in addNode/addLink/addAnchor/addZone/addFlowPath/addPolicyMarker), which makes the cascade's by-id pruning sound.

### M5. balancePage's greedy axis clustering collapses transitively-close columns into coincident nodes, after the last de-overlap pass

- **Area:** Headless API | **Location:** `src/api/tidy.ts:174` | **Type:** layout
- **Problem:** alignAxis merges a cluster as long as each consecutive sorted gap is <= tol (default 26px), so a chain of nodes each 26px apart on x — but far apart on y, hence untouched by tidy — all snap to one mean x. Two nodes that share a row then become exactly coincident. Reproduced: nodes a(200,100), b1(226,300), b2(252,500), c(278,100) → after balancePage all four at x=239, with a and c both at (239,100) — perfectly overlapping. balanceDocument/balance_topology runs tidyPage BEFORE balancePage and never re-separates after, and the tool is documented as the terminal 'run it last' pass, so the overlap ships in the final document (the returned 'after' warning count is the only hint).
- **Fix:** Bound cluster spread (merge only while value - clusterStart <= tol), or run a tidy de-overlap pass after balancePage in balanceDocument/balanceLayout.

### M6. removeElement cascade leaves dangling flow-path hop refs and hop linkIds

- **Area:** Headless API | **Location:** `src/api/edit.ts:160` | **Type:** correctness
- **Problem:** The cascade prunes a flow path's waypoints when their endpoint is removed, but never touches the path's hops array: a hop whose ref was the pruned waypoint remains, and removing a link leaves hops[].linkId pointing at the deleted link (hops are only cleaned for markers via flowPathId, not inside surviving paths). Reproduced: flowPath waypoints ['a','b','c'] with hops [{ref:'b',linkId:'lab'},{ref:'c'}]; removeElement('b') leaves waypoints ['a','c'] but hops still [{ref:'b',linkId:'lab'},...], and validate permanently reports 'hop ref "b" is not one of the waypoints' and 'hop linkId references missing link "lab"'. So the documented contract — cascade cleans dependents so validate stays quiet — is broken; an agent following remove_element → validate_topology gets warnings it cannot clear except by hand-editing hops, and renderers consuming per-hop data see stale tunnel/link attribution.
- **Fix:** In the node/anchor branch, filter f.hops to refs still present in f.waypoints; when removing a link (found.kind === 'link'), delete matching hops[].linkId across all flow paths.

### M7. Undo cannot revert emphasis changes: page snapshot omits emphasis/caption, corrupting history

- **Area:** Editor & Client | **Location:** `src/editor/editor.ts:2955` | **Type:** undo-redo
- **Problem:** serialize() (whose comment claims 'drops nothing') omits Page.emphasis, caption, duration and transition, and restore() never touches them. applyEmphasis() (line 1145) DOES call this.snapshot() before mutating page.emphasis, so: user clicks 'Emphasize on this frame' (or toggles an emphasis checkbox in the inspector), then presses Ctrl+Z — the undo entry pops but the emphasis/dimming stays exactly as it was; pressing undo again reverts the user's PREVIOUS edit instead. Every emphasis toggle pushes an un-revertable junk entry, so undo appears off-by-one/broken in any emphasis workflow, and redo can never restore a cleared emphasis either.
- **Fix:** Include emphasis (and caption/duration/transition if they are ever snapshotted) in serialize() and restore() — restore must also delete the fields when absent in the snapshot. Add a test: emphasize → undo → page.emphasis is back to its prior value.

### M8. parseDoc blind-casts nodes/links; a malformed entry throws, silently breaking Open (unhandled rejection) and discarding the saved doc at boot

- **Area:** Editor & Client | **Location:** `src/pages/persist.ts:95` | **Type:** persistence
- **Problem:** Despite the module's contract ('a corrupt or hand-edited file must never crash the editor'), nodes/links/anchors are cast without per-entry validation. A doc with `"nodes": [null]` or a non-object entry makes parseDoc itself throw at the zone self-heal loop (`pg.nodes.map((n) => n.id)` on null). Consequences: (1) In the file-open handler (src/main.ts:396, an async listener with no try/catch around `parseDoc(await file.text())`), the throw becomes an unhandled promise rejection — the user clicks Open, picks the file, and nothing happens, not even the 'not a valid document' alert. (2) At boot, loadLocal()'s catch returns null and the app silently swaps in sampleDocument(); the first edit then autosaves over the possibly hand-recoverable saved doc. Entries that don't throw (e.g. nodes missing numeric x/y or id) flow straight into the editor as NaN geometry.
- **Fix:** Filter each nodes/links/anchors entry to well-formed objects (string id, finite x/y for nodes, string from/to for links) the way stencils/layers already are, and wrap the fileInput handler body in try/catch so a parse failure always surfaces the existing alert.

### M9. Deleting a node leaves dangling flow-path waypoints and policy markers (error-level problems the UI created itself)

- **Area:** Editor & Client | **Location:** `src/editor/editor.ts:1094` | **Type:** state-management
- **Problem:** deleteSelected() cascades link removal and prunes zone membership, but never touches page.flowPaths[].waypoints or page.policyMarkers[].nodeId. Scenario: user adds a flow path through nodes A→B→C and a policy marker on B, then deletes B — validateDocument immediately reports `waypoint references missing` (warn) and `'nodeId' references missing` (ERROR, src/api/validate.ts:267-268), so the problems panel turns red from a normal delete, exports/MCP validate_topology flag the doc, and the only fix is hand-editing refs in the inspector. parseDoc's load-time self-heal (persist.ts:111-116) also only repairs zones, so these dangling refs persist across save/load forever.
- **Fix:** In the same cascade, filter each flowPath's waypoints to surviving node/anchor ids (dropping paths left with <2 waypoints) and remove policyMarkers whose nodeId was deleted; mirror the same rules in parseDoc's self-heal.

### M10. Export backdrop rect ignores the viewBox origin — broken SVG/PNG exports after 'fit to content'

- **Area:** Editor & Client | **Location:** `src/editor/export.ts:31` | **Type:** export-correctness
- **Problem:** pageToSVG() draws the dark background at x=0,y=0 sized vw×vh, but sets the wrapper's viewBox to page.viewBox — whose origin is routinely non-zero: fitPageToContent() produces `${Math.round(b.x - 48)} ${Math.round(b.y - 48)} …` and growPageToFit()/tidy can yield negative origins (editor.ts:307, 328-332). Scenario: user draws content around x≈500, clicks 'fit to content' (viewBox becomes e.g. '82 40 900 620'), exports PNG — the backdrop rect covers only the region from page coords (0,0) to (900,620), so part of the exported image sits on a transparent/black background and the dark panel is offset from the art. Both the fSvg and fPng toolbar buttons hit this path.
- **Fix:** Parse the full viewBox (x, y, w, h) and emit the rect at the viewBox origin: `<rect x="${vx}" y="${vy}" …/>`. Add a test exporting a page with a non-zero-origin viewBox.

### M11. `extra` passthrough is spread after validated fields, letting tool input override id/type/x/y with arbitrary types and defeating the zod layer

- **Area:** MCP Server | **Location:** `src/mcp/tools.ts:393` | **Type:** input-validation
- **Problem:** register.ts's stated contract is that 'type coercion like Number("abc") -> NaN can't slip through' because args are zod-validated. But add_node and add_link accept extra: z.record(z.string(), z.unknown()) and spread it LAST in the object passed to addNode/addLink, so it silently overrides every validated field: add_node with extra: { x: "NaN", type: 42, id: ["a"] } stores a node whose x is a string, whose type is a number, and whose id is an array. builder.addNode does no validation. The poisoned element then breaks downstream calls on that topology (render_svg/tidy/layout arithmetic on string coordinates; update_element/remove_element cannot address a non-string id because locate() compares e.id === id), and it persists to DO storage and into share snapshots consumed by the browser viewer. upsert_by_source's `set` (z.unknown values, cast unchecked into NodeInput) has the same hole. Errors are per-call so the session survives, but the document is durably corrupted with no in-band repair path except delete/reimport.
- **Fix:** Spread `extra` FIRST and the validated fields last, and strip reserved keys (id, type, x, y, from, to, layer) from extra/set/upsert props. Add minimal type guards in builder/edit for coordinates (finite numbers) and ids (strings).

### M12. share_topology: unbounded, unmetered KV writes with no snapshot size cap, exposed to any GitHub account

- **Area:** MCP Server | **Location:** `worker/mcp.ts:110` | **Type:** resource-exhaustion
- **Problem:** Every share_topology call mints a fresh random id and writes a new KV value with a 30-day TTL — there is no per-user/per-session rate limit, no quota, and no cap on serialized document size (KV rejects only at its own 25 MiB value limit). The OAuth gate in worker/default-handler.ts issues a grant to ANY GitHub account (handleCallback has no allowlist/org check), so anyone with a free GitHub login can drive an agent loop that writes arbitrarily many multi-megabyte public snapshots — KV storage cost, write-op cost, and a public unauthenticated hosting endpoint (/v/:id serves the JSON to anyone). A single misbehaving agent retry-loop also does this accidentally, since the tool description encourages re-running after edits ('a new link' every time).
- **Fix:** Enforce a max serialized snapshot size before the KV put, add a per-session/per-user publish rate limit (the DO is the natural place to count), key snapshots by user for quota/cleanup, and decide explicitly whether any-GitHub-account access is intended for launch.

### M13. import*topology/parseDoc blindly casts element arrays, so imports bypass the per-field validation the add*\* tools enforce

- **Area:** MCP Server | **Location:** `src/pages/persist.ts:95` | **Type:** correctness
- **Problem:** parseDoc validates page-level scalars carefully but casts every element collection with zero shape checking: `nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : []` (same for links, anchors, flowPaths, policyMarkers; customNodes at line 117 is also a blind cast). import_topology therefore accepts documents whose nodes lack ids or coordinates, whose links have non-string endpoints, or whose customNodes are arbitrary junk — the exact inputs the add_node/add_link zod shapes reject. The import 'succeeds' and returns an id, and the breakage surfaces later as errors from render_svg/validate_topology/update_element on that topology (e.g. a null entry in nodes makes locate() throw `e.id` on null), which reads to the agent as a broken server rather than a rejected import. This is a semantic divergence between the two ingestion paths of the same tool surface, and it is the path by which malformed structures reach DO storage and share snapshots.
- **Fix:** Validate or normalize each element on import: require an object with a string id (generate one otherwise), coerce/verify required per-kind fields (type/x/y, from/to, waypoints), and drop entries that cannot be normalized — mirroring the self-heal already done for zone membership. Alternatively run validateDocument at import time and reject on structural errors.

### M14. No staging or preview environment; any non-production deploy shares production KV (OAuth tokens, share snapshots) — and PR previews are known-broken anyway

- **Status (2026-07-13): Closed.** Delivered by Packet D1 (PR #149):
  `wrangler.jsonc` now declares an `env.staging` block with its own KV
  namespaces, Durable Object namespaces, GitHub OAuth App/secret, and
  `PUBLIC_BASE_URL`, and a `scripts/check-wrangler-env.mjs` CI guard asserts
  staging and production share no resource ids. The `topology-dojo-staging`
  Worker is deployed and healthy with migrations `v1`–`v3` applied — first
  fully-green gated deploy
  [Deploy Staging run #4](https://github.com/robertsonc/topology-dojo/actions/runs/29219841599)
  (SHA `104b4d5`, smoke 7/7 including sha verification). Non-production Workers
  Builds branch builds are disabled (operator O1), so no non-production deploy
  reads or writes production KV.

- **Area:** CI/CD & Release | **Location:** `wrangler.jsonc:42` | **Type:** environments
- **Problem:** wrangler.jsonc defines a single environment: no [env.staging]/[env.preview] blocks, no preview_id on the KV namespaces, hard-coded production namespace IDs, and one DO binding. Any deploy that isn't production — a Workers Builds PR preview or a developer testing 'wrangler deploy' — would read and write the production OAUTH_KV (live OAuth grants/tokens) and TOPOLOGY_KV (live share links). On top of that, the repo's own docs state that 'wrangler versions upload' — which is what Workers Builds uses for non-production-branch preview builds — fails with error 10211 because of the Durable Object migration, so PR preview deployments cannot work at all. Net effect for launch: there is nowhere to exercise the GitHub OAuth flow, the MCP endpoint, or the DO/KV wiring before it hits production users.
- **Fix:** Add an [env.staging] (or a second Worker) with its own KV namespaces, DO namespace, GitHub OAuth App (distinct callback URL), and PUBLIC_BASE_URL; deploy every merge there first and promote to production after a smoke test. Disable Workers Builds non-production-branch builds explicitly since they are known to fail, or scope them to the staging env.

### M15. No post-deploy smoke test, no alerting, and no rollback procedure — observability:true is the entire ops story

- **Status (2026-07-13): Substantially addressed; open pending alerting +
  game-day.** Post-deploy smoke shipped as `scripts/smoke.mjs` (Packet D4,
  PR #146) and runs on every gated deploy, with `--sha` deployed-commit
  assertion and a `--wait-live` propagation window; `GET /healthz`
  (unauthenticated liveness + sha) and `GET /readyz` (owner-authenticated
  per-binding readiness) were added in Packet D3 (PR #148); a written rollback
  and migration-boundary forward-recovery procedure exists in
  [`../ROLLBACK.md`](../ROLLBACK.md). Still **open**: Cloudflare error-rate
  alerting, failed-workflow notifications, and a nightly staging smoke
  (operator O12 — the trip thresholds are set in
  [`../DEPLOYMENT_RUNBOOK.md`](../DEPLOYMENT_RUNBOOK.md) §"Activation observation
  window and thresholds"), plus the one-time staging forward-recovery game day
  ([`../ROLLBACK.md`](../ROLLBACK.md) §"Staging game day").

- **Area:** CI/CD & Release | **Location:** `wrangler.jsonc:47` | **Type:** release-verification
- **Problem:** Nothing verifies a deploy after it lands. The whole site — SPA, login gate, share API, and MCP — sits behind one OAuthProvider wrapper in worker/index.ts, so a single bad change (rotated GITHUB_CLIENT_SECRET not updated, KV binding renamed, broken migration) takes down everything at once, and the first signal would be a user report. There is no health endpoint, no post-deploy curl check, no alerting configured (observability only enables logs), and no docs mention rollback anywhere in README/docs/. Rollback is also nontrivial here: `wrangler rollback` cannot cross the Durable Object SQLite migration boundary declared in migrations, so the team needs a written procedure before launch, not during an incident.
- **Fix:** Add a post-deploy smoke step (curl GET /login expect 200, GET /.well-known/oauth-authorization-server expect 200, unauthenticated GET / expect 302 to /login, GET /api/topology/nonexistent expect 404) run from the deploy job or a scheduled workflow; configure a Cloudflare notification/alert on Worker error rate; write a ROLLBACK.md covering `wrangler rollback` and its DO-migration limits.

### M16. worker/ has zero test coverage and is excluded from the vitest include path; no e2e or integration tests in CI

- **Area:** CI/CD & Release | **Location:** `vite.config.ts:55` | **Type:** test-coverage
- **Problem:** Vitest only picks up src/\*_/_.test.ts, so the entire worker/ directory — the OAuth authorize/callback exchange, the web-login vs MCP-client state discrimination (isWebCallback), the document-navigation auth gate, and the public share-snapshot API in worker/default-handler.ts — is exercised by nothing except tsc. These are exactly the security-sensitive, regression-prone paths (the wrangler.jsonc comment even records a past 'sign-out does nothing' bug in this gating logic), and CI would go green on a change that breaks login for every user. @cloudflare/vitest-pool-workers exists precisely for testing Worker fetch handlers against the workerd runtime with mock KV/DO bindings.
- **Fix:** Add worker tests via @cloudflare/vitest-pool-workers (or at minimum unit tests of defaultHandler/auth.ts with stubbed env) covering the auth gate, /callback state branching, and /api/topology method/id handling; wire them into `npm test` so CI runs them, and add one wrangler-dev-based e2e that boots the Worker and hits /login and /api/topology/:id.

### M17. Inspector interpolates element type into innerHTML unescaped (XSS on node selection from a shared doc)

- **Area:** Injection & Rendering | **Location:** `src/main.ts:1015` | **Type:** xss
- **Problem:** parseDoc does not constrain node.type / link.type strings. renderInspector builds the inspector via `inspector.innerHTML = html`, and typeRow() interpolates the raw type string into both an <option> value and its text content without escaping. When a victim who has opened a shared /v/<id> document clicks a node whose type is `</option></select><img src=x onerror=alert(document.domain)>`, the payload is parsed as HTML and executes on the app origin. It is interaction-gated (requires selecting the crafted element) but needs no attacker interaction beyond publishing the document.
- **Fix:** Escape `t` in both the option value and text content (the file already has esc()), and validate node.type/link.type against the known catalog on import.

### M18. Open redirect in the sign-in flow via backslash bypass in safePath()

- **Area:** Worker & Auth Security | **Location:** `worker/auth.ts:39` | **Type:** open-redirect
- **Problem:** safePath() is the only guard on the post-login redirect target (the `go` param), and it only rejects values starting with `//`. A value like `/\evil.com` passes (starts with `/`, not `//`), is stored in the state cookie by startWebLogin, and is emitted verbatim as the Location header by completeWebLogin (`headers.append('location', safePath(go ?? '/'))`, line 147). Browsers normalize backslashes to slashes during URL parsing, so `Location: /\evil.com` resolves to `https://evil.com/`. Confirmed locally: `new URL('/\evil.com','https://topology-dojo.example.com').href` === `https://evil.com/`. An attacker sends a victim `https://topology-dojo.../login?go=/%5Cevil.com`; after a legitimate GitHub sign-in the victim is silently redirected off-site to a phishing/credential-harvesting page that looks like a continuation of the trusted flow.
- **Fix:** Reject any path containing a backslash and require it to start with a single '/'. Prefer resolving against the origin and confirming the result stays same-origin: `const u = new URL(p, origin); return u.origin === origin ? u.pathname + u.search : '/'`. Apply in both startWebLogin and completeWebLogin.

### M19. No account allowlist — any GitHub user worldwide is granted access despite "Authorized GitHub accounts only"

- **Area:** Worker & Auth Security | **Location:** `worker/default-handler.ts:126` | **Type:** authorization
- **Problem:** Both the web login (completeWebLogin) and the MCP OAuth grant (handleCallback) accept ANY GitHub identity — there is no allowlist of permitted user ids/logins anywhere in worker/ or src/server/ (grep for allowlist/authorized/allowed_users returns only the login-page marketing string). handleCallback issues an MCP grant for whoever authenticates (`props: { id: user.id, login: user.login, ... }`) and completeWebLogin signs a session for any GitHub user. Yet the login page asserts `Authorized GitHub accounts only.` (worker/auth.ts:207). Effect: every one of GitHub's ~100M accounts can pass the gate, open the editor, and drive the authenticated MCP server (creating Durable Objects and publishing world-readable KV snapshots on your account's dime). The stated access-control policy is not implemented.
- **Fix:** Add an explicit allowlist (env var of GitHub numeric ids or an org-membership check via the GitHub API) and enforce it in BOTH completeWebLogin and handleCallback before signing a session / calling completeAuthorization; return 403 otherwise. If open signup is actually intended, remove the false "Authorized accounts only" claim.

### M20. Published share snapshots are unauthenticated, unrevocable, and hard-cached for 24h

- **Area:** Worker & Auth Security | **Location:** `worker/default-handler.ts:52` | **Type:** data-exposure
- **Problem:** serveSnapshot returns any `doc:<id>` from KV to anyone, with `Cache-Control: public, max-age=86400, immutable`. share_topology (worker/mcp.ts publish) writes the full topology document — internal network node metadata, addresses, zone/policy data — to this public URL keyed by a 12-hex-char id. There is no delete/unpublish endpoint and no auth on read, so once a link is created it cannot be revoked: even after the KV entry is (manually) removed, edge/browser caches serve it for up to 24h due to the immutable directive, and the KV entry itself persists for 30 days regardless. A user who shares by accident, or whose link leaks, has no way to take it down. The immutable+public cache directive on privacy-sensitive, user-generated content is the sharp edge.
- **Fix:** Provide an authenticated unpublish/delete endpoint that removes `doc:<id>`, drop `immutable` (use a short max-age or `private`/`no-store` so revocation is possible), and consider requiring the snapshot to encode ownership so only the publisher can delete. Document the 30-day PII retention.

### M21. Entire worker/ directory (auth, OAuth callback routing, share API) has zero tests and is excluded by the vitest include glob

- **Area:** Test Coverage | **Location:** `worker/default-handler.ts:158` | **Type:** test-coverage
- **Problem:** No test imports anything from worker/ (grep over src/**/\*.test.ts finds nothing), and vite.config.ts sets include: ['src/**/\*.test.ts'], so even if a worker test were written it would not run. Untested security-relevant logic includes: the dual-purpose /callback dispatch (isWebCallback state-prefix check deciding whether a GitHub redirect issues a browser session cookie or an MCP grant), the web-login state-nonce validation in completeWebLogin (worker/auth.ts:94), the open-redirect guard safePath (worker/auth.ts:39-41), the document-navigation auth gate (isDocumentNavigation + the /v/ shared-view carve-out, default-handler.ts:178-185), and the token-exchange error paths. Only the HMAC cookie primitives in src/server/session.ts are unit tested — the code that decides WHO gets a cookie and WHERE requests are redirected is not. Concrete regression scenario: someone tweaks the WEB_STATE_PREFIX handling or the isSharedView condition; the editor is silently served unauthenticated (or MCP callbacks start minting browser sessions), CI stays green, and it ships.
- **Fix:** Add a worker test suite using @cloudflare/vitest-pool-workers (or at minimum plain vitest unit tests with mocked fetch/env for auth.ts and default-handler.ts, which are already dependency-injectable via Request/env). Priority cases: safePath rejects '//evil' and absolute URLs; /callback with web.-prefixed state never reaches handleCallback and vice versa; nonce mismatch returns 400; unauthenticated document navigation to '/' redirects to /login while '/v/abc' and sub-resource fetches do not; /api/topology/:id rejects non-GET. Widen the vitest include (or add a second project) so worker tests actually execute in CI.

### M22. MCP-over-worker Durable Object path untested: persistence gating (READONLY_TOOLS) and real KV publish never execute under test

- **Area:** Test Coverage | **Location:** `worker/mcp.ts:33` | **Type:** test-coverage
- **Problem:** TopologyMcp (worker/mcp.ts) is the production MCP server, and its three critical behaviors are untested: (1) persistAfter skips persistence for any tool name in the hardcoded READONLY_TOOLS string set — no test asserts this set stays a subset of actual tool names or that every mutating tool triggers a write, so if a tool is renamed (or a new tool's name is accidentally added to the set), mutations silently stop reaching DO storage and topologies vanish on hibernation — the exact data-loss failure the code comment calls the QA 'blocker' (mcp.ts:55-59); (2) publish() — the real shareId generation, KV put with TTL, and PUBLIC_BASE_URL link construction (mcp.ts:106-115) — is bypassed in tests: tools.test.ts:766 injects a stub publishTopology and asserts the stub's own return value, so the KV path has zero coverage; (3) the init/rehydrate ordering with McpAgent hibernation is only simulated via a Map-backed fake in persist-store.test.ts, never against the workerd DO runtime. persist-store.test.ts itself is a good unit test, but everything wiring it into production is uncovered.
- **Fix:** Add a cheap drift-guard unit test: assert every READONLY_TOOLS entry matches a name in createTools() output, and assert specific mutating tools (add_node, update_element, delete_topology, build_flow_topology) are NOT in the set. Add a vitest-pool-workers integration test that drives TopologyMcp end-to-end: create a topology, force a new DO instance, and assert the id still resolves; and one that calls share_topology against a real (miniflare) KV namespace and then GETs /api/topology/:id.

### M23. parseDoc accepts untrusted JSON but element arrays are cast wholesale with no per-element validation, and no test exercises malformed nodes/links

- **Area:** Test Coverage | **Location:** `src/pages/persist.ts:95` | **Type:** test-coverage
- **Problem:** parseDoc is the single validation gate for three untrusted-input paths: user file import (src/main.ts:400), fetched share snapshots from KV (src/main.ts:322), and the remote MCP import_topology tool available to any GitHub-authenticated user (src/mcp/store.ts:38). It carefully validates page-level scalars and palettes, then casts every element list unchecked — a node entry like {"id": 42, "x": "abc"} or a bare string inside the nodes array flows straight into the editor, the renderer, and DO persistence. persist.test.ts only tests missing arrays and page-level corruption ('fills in missing fields defensively'), never malformed element entries, so the gap between the module's stated contract ('a corrupt or hand-edited file must never crash the editor') and its behavior is invisible to CI. Failure scenario: a hand-edited or adversarial share JSON with a non-numeric node x produces NaN geometry — blank canvas or a hit-test/render exception after 'import succeeded', and via import_topology the poisoned doc is persisted to DO storage where it re-breaks every rehydrate.
- **Fix:** Add element-level normalization in parseDoc (drop entries without string id / finite x,y; coerce or drop bad link endpoints) and negative unit tests feeding malformed element entries through all three entry points: parseDoc directly, store.import(), and rehydrateStore with a corrupted stored value. A small property/fuzz test (random JSON mutations must yield null or a document that renderDocumentToSVG can render without throwing) would lock the contract.

### M24. editor.ts — 2,975 lines of interaction logic (undo/redo, drag, marquee, pan/zoom, snapping) with zero tests

- **Area:** Test Coverage | **Location:** `src/editor/editor.ts:97` | **Type:** test-coverage
- **Problem:** The Editor class is the core product surface and the largest file in src/, and it has no test file; only its leaf helpers (geometry.test.ts, clone.test.ts, caption.test.ts, legend.test.ts, stencil.test.ts) are covered. Untested logic includes the JSON-string-based undo/redo stacks with 100-entry cap and coalesced arrow-nudge entries (lines 967-1027, with subtle pop-if-unchanged bookkeeping at lines 259, 275, 290), the DragState multi-select move with snap deltas, marquee selection, waypoint drags, format-painter key lists, and pan/zoom viewBox math. Failure scenario: a refactor of snapshot() or the pop-on-no-change logic silently corrupts history — undo restores a stale page or drops a user's last edit — and nothing in CI notices because no test ever constructs an Editor. Much of this class is pure state-machine logic over Page objects and is unit-testable today without a browser (pointer handlers are thin wrappers over testable methods).
- **Fix:** Extract-and-test or jsdom-test the Editor: unit tests for undo/redo invariants (snapshot → mutate → undo restores byte-identical page; no-op interactions leave history depth unchanged; redo cleared on new edit), selection/marquee set math, and snap-delta computation. Add 2-3 Playwright smoke flows (drop node, drag, undo, reload-from-autosave) as the integration backstop.

### M25. main.ts app shell (share-view loading, file import, autosave boot, auth chip) untested and no e2e harness exists

- **Area:** Test Coverage | **Location:** `src/main.ts:315` | **Type:** test-coverage
- **Problem:** src/main.ts is 2,905 lines wiring every feature together and has no tests: the /v/:id share-view path (fetch /api/topology/:id, parseDoc, fallback when the snapshot 404s after the 30-day KV TTL — the only public-facing feature of the product), the file-import flow at line 400, localStorage autosave/restore boot ordering, and the /api/me login chip (line 2580) with its dev-mode 404 handling. CI (typecheck/vitest-node/lint/build) never loads the SPA in a browser, so a regression anywhere in this glue — e.g. share links rendering a blank editor because the fetch error branch regressed — ships with a green build. Likelihood is high because this file changes with nearly every feature.
- **Fix:** Add a minimal Playwright job to CI against `vite preview` (plus wrangler dev for the share API): (1) app boots and renders the sample document; (2) /v/:id with a seeded snapshot renders read-only; (3) /v/:id with an unknown id shows the fallback rather than a blank page; (4) JSON file import of a valid and an invalid file. Four tests would cover the product's whole public entry surface.

### M26. No rendering snapshot/visual regression coverage; vendored engine integration and the cache-bust plugin are untested

- **Area:** Test Coverage | **Location:** `vite.config.ts:24` | **Type:** test-coverage
- **Problem:** The headless render tests (src/server/render.test.ts, 25 cases) are good behavioral tests but assert substrings of the SVG string in Node — there is no pixel/DOM snapshot baseline, so visual regressions (z-order/layer stacking, marker glyph geometry, theme/palette remapping, CSS animation output) that keep the asserted substrings intact ship silently. The actual browser canvas additionally renders through the vendored engine loaded via raw `<script src="/vendor/…">` tags, whose freshness depends entirely on the vendorCacheBust regex in vite.config.ts — itself untested, so a regression in that regex (or a renamed vendor path) silently stops cache-busting and browsers keep a year-stale immutable engine while the hashed app bundle moves on: exactly the app/engine skew the plugin's own comment warns about, now unguarded.
- **Fix:** Two cheap additions: (1) a unit test for vendorCacheBust asserting every /vendor/ reference in the real index.html gets a ?v= hash appended (fails loudly if a vendor file goes missing or the regex rots); (2) SVG-string golden-file snapshots (vitest toMatchFileSnapshot) for 3-4 fixture documents in the existing Node render tests — full-output snapshots catch the geometry/stacking regressions the substring assertions miss, no browser needed. Playwright screenshot baselines can come later.

### M27. Vendored engine load failure leaves a silently dead app with no error message

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:232` | **Type:** degraded-state
- **Problem:** The renderer is a classic deferred script (index.html: '/vendor/topology-ds.js') that sets window.TopologyDesigner; the typed facade throws if it is absent. main.ts constructs `new Editor(...)` at module top level with no try/catch; the Editor constructor calls renderArt() -> renderPageInto() -> engine(), which throws. The uncaught exception aborts the rest of the module, so everything wired after line 232 (all toolbar listeners, palette build, filmstrip, keyboard handlers) never runs. Failure scenario: a deploy where the 300KB+ vendor bundle 404s or a flaky network drops it -> user sees the toolbar chrome render, but the palette/filmstrip are empty, the canvas is blank, and every button is dead — with zero user-facing message (only a console error). Nothing detects the failure or offers a reload.
- **Fix:** Guard app boot: check `window.TopologyDesigner` before constructing the Editor (or wrap boot in try/catch) and render a visible error state in #app ('The diagram engine failed to load — reload to retry') instead of letting the module die silently.

### M28. Frame deletion is unrecoverable and confirm is skipped for annotation-only frames; switching frames wipes all undo history

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2145` | **Type:** destructive-action-safety
- **Problem:** deletePage() confirms only when the page has nodes or links; a frame containing only zones, flow paths, policy markers, anchors, or a caption is deleted with no confirmation. Undo cannot recover it because the undo stack lives in the Editor and is page-scoped: setPage() zeroes undoStack/redoStack. Failure scenario 1: user builds a frame of zones + flow-path annotations over an empty canvas, clicks the ✕ on the wrong frame -> gone instantly, no confirm, no undo. Failure scenario 2: user presses ArrowRight with nothing selected (which flips pages, main.ts:2715) mid-edit, flips back -> Ctrl+Z now does nothing; all history for the frame they were editing is silently destroyed.
- **Fix:** Treat any non-empty collection (zones/flowPaths/policyMarkers/anchors/caption) as content for the confirm; better, make page deletion undoable (document-level history or a toast with 'Undo'). Keep per-page history across setPage, or at minimum keyed by page id.

### M29. Global single-key shortcuts stay live behind the node-designer modal, which also has no Escape or focus trap

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2594` | **Type:** focus-management
- **Problem:** The window keydown handler only exempts INPUT/SELECT/TEXTAREA/contentEditable targets; it has no notion of an open modal. The node-designer (nd-modal) closes only via Cancel or backdrop click — no Escape handler, no focus trap, no focus move on open. Failure scenario: user opens 'design node', clicks a shape tile (a <button>, so the exemption doesn't apply), then presses Delete/Backspace intending to fix a name -> editor.deleteSelected() destroys the canvas selection hidden behind the modal; pressing 'v'/'l'/'t' silently switches tools or re-lays-out the diagram behind it. The help overlay has role=dialog but no aria-modal, no focus moved into it, and closing the find palette drops focus to <body>.
- **Fix:** Suppress global shortcuts while any modal/popover is open (a shared 'modalOpen' check or checking e.target.closest('.nd-modal,.help-backdrop,.find')). Add Escape-to-close and initial focus + focus trap (or use <dialog>) for the designer and help overlays; restore focus to the invoker on close.

## LOW (9)

### L1. Ungoverned second deploy path: `npm run deploy` ships the local working tree to production, bypassing CI and conflicting with Git-integration deploys

- **Status (2026-07-13): Closed.** The `npm run deploy` script was deleted in
  Packet D1 (PR #149). Deploys now run only through the gated GitHub Actions
  workflows (`deploy-staging.yml` / `deploy-production.yml`), each of which
  re-runs the CI `check` before deploying; there is no longer a laptop path
  that can push a local working tree to the production Worker.

- **Area:** CI/CD & Release | **Location:** `package.json:15` | **Type:** deploy-pipeline-safety
- **Problem:** The deploy script does a full production `wrangler deploy` from whatever is on the developer's disk — uncommitted or unpushed changes included — with no tests and no record in Git. It coexists with the Workers Builds auto-deploy, so the two paths silently clobber each other: a laptop deploy is reverted by the next push to main, or a laptop deploy of a stale branch overwrites what main deployed. src/mcp/README.md even instructs running `npm run deploy` as part of TOPOLOGY_KV setup, normalizing the bypass. Because wrangler deploy takes 100% traffic instantly, one accidental invocation from the wrong checkout replaces production.
- **Fix:** Remove the script or repoint it at the staging env (wrangler deploy --env staging); make Workers Builds (or a gated Actions job) the only path that can touch the production Worker, and scope developer API tokens so they cannot deploy the production script.

### L2. CI supply-chain hardening absent: tag-pinned actions, default GITHUB_TOKEN permissions, no dependency audit or update automation

- **Area:** CI/CD & Release | **Location:** `.github/workflows/ci.yml:12` | **Type:** supply-chain
- **Problem:** Actions are pinned to mutable major tags (actions/checkout@v4, actions/setup-node@v4) rather than commit SHAs, the workflow declares no `permissions:` block so the GITHUB_TOKEN gets the repo default (potentially write) while `npm ci` executes arbitrary dependency lifecycle scripts, and there is no `npm audit` step for the three production dependencies (which include the OAuth provider guarding live tokens) nor any Dependabot/Renovate config (.github/ contains only ci.yml). For a worker handling OAuth grants, a compromised action or dependency in this pipeline is a credential-adjacent risk.
- **Fix:** Add `permissions: { contents: read }` at workflow level, pin both actions to full commit SHAs, add a step `npm audit --omit=dev --audit-level=high`, and commit .github/dependabot.yml covering npm and github-actions ecosystems.

### L3. Entire Vite/Vitest config cast `as never`, disabling type checking of build and test configuration

- **Area:** CI/CD & Release | **Location:** `vite.config.ts:57` | **Type:** build-config
- **Problem:** defineConfig's argument is cast to never (to smuggle the vitest `test` key past Vite's types instead of importing defineConfig from 'vitest/config'). This turns off compile-time validation of every field: a typo in outDir, target, or the test include glob would be silently accepted. Since wrangler.jsonc hard-codes assets.directory: './dist', a mistyped outDir would produce a deploy that serves a stale or empty asset directory — and with no post-deploy smoke test (see separate finding) nothing would catch it before users do.
- **Fix:** Import defineConfig from 'vitest/config' (which types the test key over Vite's config) and delete the `as never` cast so the config is type-checked by the CI typecheck step.

### L4. No security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on app, login, or share responses

- **Area:** Worker & Auth Security | **Location:** `public/_headers:10` | **Type:** security-headers
- **Problem:** public/\_headers only sets Cache-Control for /vendor/\*. Nothing sets a Content-Security-Policy, X-Frame-Options/frame-ancestors, X-Content-Type-Options, or Referrer-Policy for the SPA, the self-rendered login page (worker/auth.ts loginPage), or the public /v/<id> share view. Consequences on an OAuth-authenticated app: (1) the editor and login page can be framed by any origin -> clickjacking; (2) absence of CSP means any reflected/stored XSS (e.g. via topology node labels rendered into SVG on the public share view) executes with no mitigation; (3) no nosniff. For a production launch this is a baseline gap across every HTML response.
- **Fix:** Add a global \_headers block (and/or set headers in the Worker for dynamic responses) with a restrictive Content-Security-Policy, X-Frame-Options: DENY (or frame-ancestors 'none'), X-Content-Type-Options: nosniff, and Referrer-Policy: strict-origin-when-cross-origin. The login and share pages especially must be un-frameable.

### L5. Unauthenticated dynamic client registration and no rate limiting on any write path

- **Area:** Worker & Auth Security | **Location:** `worker/index.ts:40` | **Type:** rate-limiting
- **Problem:** clientRegistrationEndpoint '/register' is exposed with no authentication (standard for the provider, but note it) and there is no rate limiting anywhere in the Worker. An anonymous attacker can loop POST /register to fill OAUTH_KV with client records, and any signed-in GitHub user (see the no-allowlist finding) can loop share_topology to fill TOPOLOGY_KV with 30-day snapshots. There is no per-IP or per-user throttle, quota, or size cap on either write path, so both KV namespaces can be inflated at will — a cost/DoS and storage-abuse vector with no backpressure.
- **Fix:** Put Cloudflare Rate Limiting (or a DO/KV counter) in front of /register, /callback, /auth/github, and the share-publish tool; cap snapshots per user and per time window; and constrain snapshot payload size.

### L6. Cookie attribute injection via unencoded `go` in the OAuth state cookie

- **Area:** Worker & Auth Security | **Location:** `worker/auth.ts:73` | **Type:** cookie-handling
- **Problem:** startWebLogin builds the state cookie as `cookie(COOKIE_STATE, `${nonce}|${go}`, 600)` where `go` is an attacker-influenced path that is not URL-encoded before being placed into the Set-Cookie value. A `go` containing `;` lets the attacker inject additional cookie attributes into the tdg_oauth_state Set-Cookie header (e.g. `go=/x;Max-Age=99999999` or a `Domain=`/`Path=` override), and a `;` also silently truncates the stored return path when parseCookies later splits on `;`. Blast radius is limited to the short-lived state cookie, but it is unsanitized attacker input flowing into a response header.
- **Fix:** encodeURIComponent(go) before embedding it in the cookie value (and decode on read), or store only the nonce in the cookie and keep `go` in the GitHub state parameter.

### L7. share_topology and surface-inventory tests assert stubs/name lists rather than production behavior

- **Area:** Test Coverage | **Location:** `src/mcp/tools.test.ts:766` | **Type:** tautological-tests
- **Problem:** Two coverage soft spots inside the otherwise strong tools.test.ts: (1) the share_topology test injects a fake publishTopology and then asserts the fake's hardcoded return URL — it validates the plumbing between tool and dep (worthwhile) but reads as if publishing is covered when the production publisher (worker/mcp.ts publish → KV, TTL, PUBLIC_BASE_URL trailing-slash handling) never runs under test (see the separate DO finding); (2) 'exposes the full authoring + render + discovery surface' (line 22) and 'documents every tool in the MCP README' (line 62) assert a hardcoded name list and README string mentions — useful drift guards, but they contribute to a misleadingly high sense of MCP coverage since neither exercises behavior. Risk is indirect: a reviewer sees share/inventory tests passing and assumes the publish path is safe to refactor.
- **Fix:** Keep the wiring test but rename it to make the stub explicit ('passes the stored doc to the publish dep'), and cover the real publisher in the DO/KV integration suite: assert the KV key format (doc:<12-char id>), the 30-day expirationTtl, and that PUBLIC_BASE_URL with and without a trailing slash yields a well-formed /v/:id URL.

### L8. Format painter (Copy/Paste format) exists only in the right-click context menu — unreachable by keyboard or touch and undiscoverable

- **Area:** UI / UX / A11y | **Location:** `src/main.ts:2742` | **Type:** discoverability
- **Problem:** editor.copyFormat()/pasteFormat() are wired exclusively in ctxItemsFor(); they appear in no toolbar button, no inspector control, and no keyboard shortcut (they are absent from the SHORTCUTS help overlay). The context menu itself opens only from a contextmenu event on the canvas host, is never focused, and has no arrow-key navigation, so the whole feature is right-click-only. Failure scenario: touch/trackpad users without an easy right-click, and all keyboard-only users, can never use format painting; other users will not learn it exists since the '?' shortcut reference never mentions it.
- **Fix:** Add keyboard shortcuts (e.g. Ctrl+Alt+C/V) and list them in the help overlay, and/or surface copy/paste-format buttons in the inspector's Arrange row. Move focus into the context menu on open and support ArrowUp/Down/Enter.

### L9. Icon-only controls rely solely on title attributes and several interactive elements suppress the focus indicator

- **Area:** UI / UX / A11y | **Location:** `index.html:339` | **Type:** accessibility
- **Problem:** Most toolbar/canvas controls are icon glyphs (↶, ▦, ⌗, ◓, ⚙, ⤢, ✕) whose only accessible name is the title attribute — below 1480px the text labels are hidden entirely (`.tlabel { display: none }`), so screen-reader and touch users depend on titles that never show on touch. The brand-palette swatches explicitly set `outline: none` with no replacement focus style, and the find input sets `outline: none` (border-color change only), so keyboard focus position becomes invisible on those controls.
- **Fix:** Add aria-label (duplicating the title) to icon-only buttons, and add :focus-visible styles (e.g. 2px accent outline) wherever outline is removed, including the dp-swatch and find input.

## Refuted (investigated, not real)

- **Canvas selection and filmstrip are pointer-only: keyboard users cannot select elements, switch focus to frames, or rename them** — refuted: The cited lines are real (filmstrip frames are non-focusable divs, overlay SVG binds only pointer events), but the claimed failure scenario — keyboard users cannot select, move, rename, or switch frames — is false because the reviewer missed keyboard-accessible alternate
- **prefers-reduced-motion is only honored for flow particles; the ambient animated backdrop defaults on for everyone** — refuted: The ambient 'animated' default is gated behind a second reducedMotion check the reviewer missed. Calm defaults from prefers-reduced-motion (src/main.ts:2208-2213), the editor passes calm into every render (src/editor/editor.ts:576), renderPageSVG sets `topo.reducedMotion
