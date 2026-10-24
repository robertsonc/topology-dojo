# Topology Dojo MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Topology Dojo's headless authoring + rendering API as tools, so an agent can
build, validate, and render the same topologies the GUI produces. It is a thin
adapter over `src/api` (authoring/validation) and `src/server/render` (headless
SVG). Every persisted diagram field the editor can express is reachable here;
transient browser view preferences and browser-owner governance actions are
intentionally outside the MCP authoring contract.

## Run (local, stdio)

```bash
npm run mcp        # tsx src/mcp/server.ts  — speaks MCP over stdio
```

Wire it into an MCP client (e.g. Claude Desktop / Claude Code) as a stdio server:

```jsonc
{
  "mcpServers": {
    "topology-dojo": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/path/to/topology-dojo",
    },
  },
}
```

## Run (remote, Cloudflare)

The same tool set is served over **Streamable HTTP** at `/mcp` by the Cloudflare
Worker (`worker/index.ts`), alongside the static app. A `TopologyMcp` Durable
Object hosts the transport/session and private draft store. Shared documents are
owned by a separate `TopologyDocument` Durable Object per topology, so browser
and agent writes meet at one revisioned coordinator. The renderer remains the
same engine-agnostic core, with the vendored engine bundled instead of
`require`d.

Auth is **OAuth 2.1** (Cloudflare's `workers-oauth-provider`) with **GitHub** as
the upstream identity provider. The whole Worker is wrapped in the provider;
`/mcp` is the protected API route. A client (e.g. Claude) is redirected through a
single GitHub authorize click — no token to paste — and the authenticated GitHub
user is exposed to the agent as `this.props`. The provider also serves OAuth
discovery (`/.well-known/oauth-authorization-server`) and dynamic client
registration (`/register`), so compatible clients configure themselves.

**API keys (proposal 0005, `API_KEYS_ENABLED`).** For an agent that cannot
complete a browser sign-in, a signed-in user mints a key at `/keys` and the
client sends it as `Authorization: Bearer tdk_…` on `/mcp`. The provider's
`resolveExternalToken` hook (`worker/api-keys.ts`) resolves it to the same
`props` an OAuth grant produces, plus `auth: "api_key"` and the key's
`scopes` (`author` always; `share`, `workspace`, `live-data` opt-in — a group
outside the scopes is not registered at all). Keys are hashed at rest, shown
once, revocable, optionally expiring, and only mintable in the browser.

```jsonc
{
  "mcpServers": {
    "topology-dojo": {
      "url": "https://<deployment-domain>/mcp",
      "headers": { "Authorization": "Bearer tdk_…" },
    },
  },
}
```

> **Durable Object migrations require a full, environment-scoped deploy.** This
> Worker declares migrations including the shared `TopologyDocument`
> coordinator. `wrangler versions upload` fails with error 10211 when a new
> migration is present, and Cloudflare versioned Preview URLs are not the
> supported preview surface for this stateful Worker. Do not replace the
> production non-branch command with an automatic production deploy for every
> PR. Use the isolated staging Worker and `wrangler deploy --env staging`, then
> follow the protected production process in
> [`../../docs/DEPLOYMENT_RUNBOOK.md`](../../docs/DEPLOYMENT_RUNBOOK.md).

### One-time auth setup

Repeat this setup independently for staging and production; never reuse OAuth
Apps, secrets, or KV namespace ids across environments.

1. **GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps):
   - Homepage `https://<your-domain>`, Authorization callback URL
     `https://<your-domain>/callback`.
   - Put the **Client ID** in `wrangler.jsonc` (`vars.GITHUB_CLIENT_ID`); add the
     **client secret** as a dashboard secret **`GITHUB_CLIENT_SECRET`**.
   - Optionally add a dedicated **`SESSION_HMAC_SECRET`** dashboard secret for
     signing browser session cookies. When unset, sessions fall back to
     `GITHUB_CLIENT_SECRET` (rotating the OAuth client secret then invalidates
     all browser sessions). Recommended for new environments; not required yet.
     Generate a high-entropy value and store it only in the operator password
     manager — never commit it.
2. **KV namespace** `OAUTH_KV` (dashboard → Storage & Databases → KV) — paste its
   id into `wrangler.jsonc` (`kv_namespaces`). This stores grants/tokens.
3. Deploy through the environment-specific runbook. Then connect a client to
   `https://<your-domain>/mcp`; it will run the GitHub sign-in flow
   automatically.

> State note: legacy authoring tools create private drafts in the per-user
> registry. Hand-off into a shared workspace is an owner decision made in the
> browser — agent-facing workspace tools never migrate a draft; calling one
> with a legacy topology id is rejected with guidance and the draft is left
> untouched. Once the browser hands a draft off, all further writes use
> workspace tools. The old snapshot is retained as migration rollback material
> but stale legacy mutation is refused.
>
> The read-only document tools keep working on a shared workspace:
> `get_topology`, `validate_topology`, `inspect_render`, `render_svg`,
> `export_flipbook`, `export_topology`, `view_topology` and
> `describe_capabilities` (with a `topologyId`) accept a
> workspace id and are served from the workspace's **current revision**, which
> they report — a JSON result carries `workspaceRevision`, a rendered SVG /
> flipbook carries a `<!-- workspace revision N -->` comment after its opening
> tag. Nothing is loaded into, or persisted from, the legacy registry. Writes
> go through `propose_workspace_changes` (or `apply_workspace_changes` inside
> a page lease); a mutating tool on a workspace id is refused with that
> guidance. `get_workspace_document` returns the whole document (title,
> layers, legend, custom nodes, stencils, palette, pages) with its revision.

### Share links (`share_topology` / `list_shares` / `unpublish_topology`)

`share_topology` snapshots the current document into a **KV namespace** and
returns a link that opens it in the browser editor — the way to hand a user a
viewable/shareable result after building. Because the snapshot lives in KV (not
the per-session in-memory store), the link keeps working after the MCP session
ends. The link is `<PUBLIC_BASE_URL>/v/<id>`; opening it loads the snapshot into
the editor (the SPA fetches `/api/topology/<id>`).

This link is public: anyone with the URL can view the snapshot for up to 30 days. Do not publish internal addresses, credentials, or other sensitive content. Publishing again mints a new snapshot id and URL; it does not renew the previous URL. Every snapshot URL expires 30 days after it is created. Public GETs may be cached for about a minute so an owner revoke can take effect quickly. Every publish also lands in the owner's listing index, so `list_shares` (and the browser Share dialog) can enumerate the live links. The publisher can revoke a link with `unpublish_topology` (pass the 12-character share id) or `DELETE /api/topology/<id>` while signed in as the same GitHub user; revoke deletes the KV key and `/v/<id>` then 404s. Snapshots are public to anyone with the URL; remote publishes are rate-limited per authenticated user (see [Rate limits and export size](#rate-limits-and-export-size)). These tools are **remote-only** — the local stdio server has no KV/origin, so they are not registered there.

One-time setup for the isolated staging environment (use the environment's
actual binding names and record the generated ids in `env.staging`):

```bash
npx wrangler kv namespace create TOPOLOGY_KV --env staging
# Set staging PUBLIC_BASE_URL and the generated namespace id in wrangler.jsonc.
# Provision OAUTH_KV, GITHUB_CLIENT_SECRET, and optional
# SESSION_HMAC_SECRET independently for staging.
npx wrangler deploy --env staging
```

There is no `npm run deploy` script — a laptop cannot deploy production (finding
L1). `npm run deploy:staging` runs the build, `check-wrangler-env.mjs`, and
`wrangler deploy --env staging` for local staging preflight; the GitHub
Actions workflows (`release.yml` — merging to `main` is the production
release, proposal 0007 — and `deploy-staging.yml`) are the only paths that
actually publish a deployment. See the deployment runbook for the migration
acknowledgement, bootstrap, and smoke requirements.

## Model

The local stdio server and the remote private-draft path hold topologies keyed by
an id. The usual draft-building flow is:

1. `create_topology` → returns an `id` (seeded with one empty page).
2. add elements against that id — prefer one `edit_topology` batch (many
   operations in a single call) over per-element `add_node` / `add_link` /
   `add_zone` calls, which can exhaust an agent's per-turn tool budget.
3. `validate_topology` → list of problems (empty = valid); fix layout warnings
   with `tidy_topology` / `balance_topology`.
4. `inspect_render` → a compact visual-quality report (crop, label legibility,
   link routing, density) — the cheap final QA step before rendering.
5. `render_svg` → a standalone SVG string (large — render once at the end,
   after the inspection report is clean, not after every edit).
6. `get_topology` / `import_topology` → round-trip the document JSON, which is
   the portable, canonical contract (server state is just a convenience).
   `get_topology` also offers `summary:true` (compact counts), `sources:true`
   (only source-carrying elements — an importer's diff input) and `pageIndex`
   (a single page) so agents don't reload the whole document.

Page targeting: the `add_*` tools default to the **most recently added page**;
pass `pageIndex` to target another. `render_svg` and `inspect_render` default
to page `0`.

Call `describe_capabilities` first to discover the vocabulary. It defaults to a
compact **index** (type names/categories only); request editable fields with
`detail:"full"`, or — cheaper — narrow with `types:[…]` / `query:"…"` to get
full fields for just the types the task needs (pass a `topologyId` to include
that document's custom node types).

### Link anchor box (experimental)

Links attach to the edge of the node icon by default, so a south-attached
link runs through the node label. `set_page_properties` takes
`linkAttach: { pad?, distribute? }` (`{}` = on with defaults, `"none"` clears)
to attach links to an **anchor box** instead: the node's hit box inflated by
`pad` (default 6) and extended past the label block on the label side. Ports
pin to that box; auto endpoints clip to its faces (circle/ellipse icons keep a
padded round outline off the label side). A node's own `linkAttach` (same
shape, via `update_element` / `add_node`) merges over the page's and activates
the feature for that node alone. `distribute: true` spreads every endpoint on
a node side into evenly spaced slots ordered by the far end (deterministic, no
crossings at the node; the parallel-sibling fan-out is suppressed on that
side). Links take `fromPortOffset` / `toPortOffset` in `[-1, 1]`, a fractional
shift along the attached side (side ports and auto endpoints; corner ports
ignore it). A corner port (`ne`/`nw`/`se`/`sw`) is an exact pin and is never
distributed — side ports are — and `validate_topology` warns on each such
link end while the node distributes. When two nodes sit too close for the padded box the renderer
shrinks it (pad 0, then the classic edge trim, then centre→centre) rather than
drawing the link backwards. Documents without these fields render
byte-identically to before; `inspect_render` measures the drawn endpoints in
either mode.

For a document shared with the browser, use the bounded workspace loop instead:

1. `create_workspace` for a new shared document, or `list_workspaces` to choose
   a canonical workspace. A listed legacy draft must first be opened/handed off
   by its browser owner; agent reads reject it without migration.
2. `get_workspace_manifest` → remember its revision and page ids/counts.
3. If `operationSchemaRevision` changed, call
   `describe_workspace_operations` once and cache the vocabulary.
4. `get_workspace_changes` from the last-seen revision; summaries are the
   default and avoid reloading the document.
5. `get_workspace_elements` only for pages/elements needed by the task
   (`sourcedOnly:true` for just the elements an importer owns). When the
   document-level state matters (layers, legend, custom node types, palette)
   or the whole document is really needed, `get_workspace_document`
   (`summary:true` / `pageIndex` narrow it) returns it with its revision.
   To check or render the workspace, call `validate_topology`,
   `inspect_render`, `render_svg` or `export_flipbook` with the workspace id
   directly — they serve the current revision and report it; there is no
   need to rebuild a scratch topology from element dumps.
6. `propose_workspace_changes` → a named operation batch for owner review.
   An importer uses `element.upsert` operations (schema revision 2): the
   coordinator resolves each one by source identity into `element.add` or
   `element.patch`, so re-submitting a sync never duplicates. A leased apply
   converges immediately; a proposal whose source was bound by another
   revision before acceptance is reported as a `conflict` on that source
   identity (never a second element) — re-read changes, re-diff, propose again.
   A stale base is checked field by field: when a later revision wrote the
   same field, the proposal is stamped `conflicted` and carries `conflicts[]`
   (see below) naming the committed write behind every target. When those are
   all your own earlier accepted writes, resubmit with `supersede: true`
   instead of rebasing by hand.
   Display text over the catalog caps (`label`/`name` 200, `caption` 500,
   `description` 1000, `body`/`meta` values 2000, `title` 160 — the same caps
   `describe_capabilities` advertises) is refused at submit time for the whole
   batch, naming the operation, element/page and field
   (`operations[3] element "c1" label exceeds 200 characters`), exactly as the
   direct tools reject it, so a proposal never previews text the stored
   document would truncate.
7. Use `apply_workspace_changes` only when the browser explicitly shows a live,
   current-page lease. It takes the same `supersede` flag and the same
   display-text refusal.

The browser's manifest/proposal polling is normal application JSON and is not
automatically placed into model context. Token usage is therefore proportional
to the task's affected region and change summaries, not total document size.

## Tools

| Tool                                                   | Purpose                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe_capabilities`                                | Discover node/link/annotation types and their fields                                                                                          |
| `create_topology`                                      | New document (one empty page)                                                                                                                 |
| `list_templates` / `create_from_template`              | List starter templates; instantiate one as a new document                                                                                     |
| `list_topologies` / `get_topology` / `delete_topology` | Manage held documents                                                                                                                         |
| `import_topology`                                      | Load from document JSON, a legacy Topology Studio save, a draw.io file, a Mermaid flowchart, or CSV data (`format` auto-detects)              |
| `set_document_title`                                   | Rename a document                                                                                                                             |
| `add_page` / `set_page_properties`                     | Append a frame; edit an existing page's name / viewBox / timing / lineJumps / linkAttach / `portLabels` / `caption` / `emphasis`              |
| `add_node` / `add_link` / `add_anchor`                 | Core elements                                                                                                                                 |
| `add_zone` / `add_flow_path` / `add_policy_marker`     | Annotation layer                                                                                                                              |
| `edit_topology`                                        | **Batch**: many authoring operations in one call (atomic, ordered) — preferred for building diagrams; reports `created` for upsert ops        |
| `update_element` / `remove_element`                    | Patch any element in place; remove (with dependent cleanup)                                                                                   |
| `upsert_by_source`                                     | Converge an element onto external data by source identity                                                                                     |
| `define_layer`                                         | Declare a document layer (underlay / overlay / policy / service); `opacity` dims the plane                                                    |
| `define_bundle`                                        | Declare a LAG / ECMP / ICL bundle name’s kind; links name bundles per end (`fromBundle` / `toBundle`), pills get outlines                     |
| `define_tier`                                          | Declare a wiring-sheet tier (role row, top → bottom); nodes opt in with `tier`, `layout_topology` "tiered" rows them                          |
| `define_link_style`                                    | Declare a wire class (colour / width / dash) links name via `style`; `preset: "ethernet-media"` loads the 11 Ethernet media classes           |
| `define_node_type`                                     | Add a custom node type (merged over defaults)                                                                                                 |
| `set_port_table`                                       | Draw a derived port table (Port / LAG / PHY / Peer\|Port) in the page margin beside nodes, built from their links                             |
| `set_node_metadata`                                    | Attach k/v metadata to a node (serial, version, hostname, site…)                                                                              |
| `set_legend`                                           | Toggle + position the auto-generated symbol legend / key; `columns` / `title` lay it out as a drawing-sheet Key strip                         |
| `set_palette`                                          | Brand palette — recolour canvas accents + chrome (hex; `clear` resets)                                                                        |
| `set_sheet`                                            | Drawing-sheet frame: paper size (sets page viewBoxes), border, top title, bottom-right title block (`clear` removes)                          |
| `layout_guidelines`                                    | Ground-truth layout rules + prose (read before placing nodes)                                                                                 |
| `validate_topology`                                    | Semantic **and layout** checks (overlaps, crowding, off-page); hardware-catalog cabling rules on bound nodes                                  |
| `tidy_topology`                                        | Auto-arrange: grid-snap + de-overlap + keep in bounds                                                                                         |
| `balance_topology`                                     | Tidy then align rows/columns + centre (the crisp finishing pass)                                                                              |
| `layout_topology`                                      | Arrange from scratch (hierarchical / grid / circular / force / tiered — rows by declared tiers, `mirror`, `tierZones`)                        |
| `inspect_render`                                       | Compact visual-quality report for one page (crop, label legibility, routing, density) — final QA                                              |
| `render_svg`                                           | Render a page to a standalone SVG string (`visibleLayers` filters; `theme: "light"` for a light page)                                         |
| `export_flipbook`                                      | Standalone self-playing HTML of all pages on their durations (`theme: "light"` optional)                                                      |
| `export_topology`                                      | Files: PNG / PDF (print-true, ANSI + A-series), draw.io, Visio `.vsdx`, PowerPoint `.pptx`, Mermaid, cable schedule — see [Exports](#exports) |
| `list_hardware` _(catalog)_                            | Search real hardware models: port summary, SKUs, panel confidence, GA eligibility                                                             |
| `describe_hardware` _(catalog)_                        | One model: interfaces by role / kind / speed (ranges collapsed), bond groups, provenance tiers, todo                                          |
| `bind_hardware` _(catalog)_                            | Bind a node to a model (`sku`, `stackMembers`, `face`); pins the document's catalog version                                                   |
| `assign_interfaces` _(catalog)_                        | Plan free, compatible interfaces for bound link ends (`by-role` / `first-free` / `keep`); `apply` writes                                      |
| `catalog_diff` _(catalog)_                             | What a catalog upgrade changes for the document's models and which links would newly fail                                                     |
| `view_topology`                                        | Interactive inline view in MCP Apps hosts (pan / zoom / pages / layers / downloads) — see [Inline view](#inline-view-mcp-apps)                |
| `describe_data_source` _(live-data)_                   | Identify the connected fabric data source                                                                                                     |
| `list_appliances` / `list_tunnels` _(live-data)_       | Inventory: appliances; underlay / overlay tunnels                                                                                             |
| `get_overlay_policies` _(live-data)_                   | Overlay / business-intent policy definitions                                                                                                  |
| `list_flows` / `get_flow_details` _(live-data)_        | Query fabric flow tables (active + ended); per-flow detail                                                                                    |
| `build_flow_topology` _(live-data)_                    | One shot: fabric + flows → layered, animated, tidy document                                                                                   |
| `share_topology`                                       | Publish a **public** durable snapshot; returns a browser link (remote-only)                                                                   |
| `list_shares`                                          | The owner's live published share links, newest first (remote-only)                                                                            |
| `unpublish_topology`                                   | Owner-only revoke of a public share (deletes the KV snapshot; remote-only)                                                                    |
| `create_workspace`                                     | Create a canonical shared document directly, bypassing the legacy draft path                                                                  |
| `list_workspaces`                                      | List canonical workspaces and legacy drafts without document contents                                                                         |
| `get_workspace_manifest`                               | Compact revision/page/count/proposal/lease status; rejects a legacy id without migrating it                                                   |
| `get_workspace_document`                               | The whole document (title, layers, legend, custom nodes, stencils, palette, pages) at its current revision; `summary` / `pageIndex`           |
| `describe_workspace_operations`                        | On-demand versioned operation vocabulary (revision 2 adds `element.upsert`); call only when its revision changes                              |
| `get_workspace_changes`                                | Bounded summaries or exact operations since a revision                                                                                        |
| `get_workspace_elements`                               | Targeted, paginated element hydration for one page                                                                                            |
| `propose_workspace_changes`                            | Submit a semantic change set for browser-owner review (default write path)                                                                    |
| `apply_workspace_changes`                              | Direct semantic commit only inside a live UI-granted page lease                                                                               |
| `create_checkpoint`                                    | Snapshot the workspace as a named checkpoint (restore/fork stay browser-owner)                                                                |
| `list_checkpoints`                                     | List named checkpoints (id, name, revision, page count, author)                                                                               |
| `get_authoring_guidance`                               | Owner-confirmed preferences + product guidance for this task (≤5 rules, hard token budget, `notModified`)                                     |
| `list_authoring_preferences`                           | Compact read-only summaries of the owner’s learned preferences                                                                                |
| `explain_authoring_preference`                         | One rule’s scope, trigger, rationale, confidence, and evidence counts (read-only)                                                             |

### Exports

`export_topology` turns a topology into the files network teams already work
with. Fidelity per format (what survives, what drops) is documented in
[`docs/EXPORTS.md`](../../docs/EXPORTS.md).

| `format`         | Returns                                 | Notes                                                                                                                              |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `png`            | MCP image + JSON summary                | One page (`pageIndex`). Print DPI stamped; `dpi` / `paper` / `visibleLayers` / `theme`.                                            |
| `pdf`            | Embedded `application/pdf` resource     | All pages (or `pageIndex`) on the document sheet size or `paper` (ANSI A–E, A4–A1, `fit`); raster.                                 |
| `drawio`         | Embedded XML resource                   | Layers → draw.io layers, zones → containers, metadata as shape data; re-imports with `import_topology`.                            |
| `vsdx`           | Embedded Visio resource                 | Shapes, glued dynamic connectors, page layers, metadata as Shape Data.                                                             |
| `pptx`           | Embedded PowerPoint resource            | 16:9 slide per page or per layer (`slides`); editable shapes or `pptxMode: "image"`.                                               |
| `mermaid`        | Plain text                              | Flowchart with subgraphs; one page or all pages.                                                                                   |
| `cable-schedule` | Embedded CSV (default) or XLSX resource | One row per link: both ends' device / model / interface / optic, media, negotiated speed, bundle, layer, notes (`scheduleFormat`). |

PNG and PDF are rendered server-side by resvg (WebAssembly) from the same
engine SVG the canvas shows, with JetBrains Mono embedded (a Worker has no
system fonts). External `https:` images inside a page are not fetched during
a render. A page larger than the pixel budget (40 MP on the stdio server,
16 MP on the Worker) is rendered at a lower DPI and the summary says so.

**Local server:** `export_topology` also takes `outputPath` and writes the
file instead of returning it inline — preferred for large Visio / PowerPoint /
PDF files so they don't pass through the conversation. Writes are confined to
`TOPOLOGY_DOJO_EXPORT_DIR` (default: the server's working directory).

**Hosted server:** files come back as embedded resources. In a host with MCP
Apps support, prefer `view_topology` and its download menu: the view calls
`export_topology` itself and hands the file to the host (`ui/download-file`),
so the bytes never enter the model's context.

### Inline view (MCP Apps)

`view_topology` declares an MCP Apps view (`_meta.ui.resourceUri =
"ui://topology-dojo/viewer.html"`, MIME `text/html;profile=mcp-app`). Hosts
that support MCP Apps render it in the conversation: pan (drag), zoom (wheel,
pinch, `+`/`-`/`0`), page switching (arrow keys), layer toggles, light/dark,
full screen, and downloads in every export format. The tool result keeps the
SVG in `_meta` (for the view, not the model) and gives the model a one-line
summary, so showing a diagram costs almost no context. The view is one
self-contained HTML page with no external origins (empty CSP allow-list); it
re-renders through `render_svg` and downloads through `export_topology` via
the host's `tools/call` proxy. In hosts without MCP Apps the call returns the
summary only — use `render_svg`, `export_topology` or `share_topology`.

### Authoring preferences (adaptive guidance)

The three `*_authoring_*` tools register only where the deployment enables
profiles (`PROFILES_ENABLED="true"`) for an authenticated owner. Before
authoring or laying out a topology, call `get_authoring_guidance` with the
task archetype (and workspace id, when working in one); it returns at most 5
concise directives — the owner's confirmed preferences ranked above versioned
product guidance — under a hard token budget, with overflow reported as rule
ids plus an omission count, never truncated prose. Pass the returned
`profileRevision`/`guidanceRevision` back on later calls: an unchanged profile
answers `notModified` with no instruction body. When a proposal applies a
confirmed preference, say so in its summary (e.g. "Applied your confirmed
'regional hubs as spine tier' preference").

These tools are strictly read-only. Confirmation, scoping, pause, and forget
are browser-owner actions in the Authoring Preferences panel — by
construction there is no MCP path that confirms, broadens, or undeletes a
preference.

### Shared workspace concurrency

Every operation batch carries a `baseRevision` and client-generated
`operationId`. The document coordinator atomically rebases disjoint fields and
rejects same-field or delete/edit overlap as an explicit conflict. Agents are
**Suggest only** by default. Only the browser can grant or revoke a ten-minute
lease, and the first implementation scopes it to the current page; it is an
authority grant, not a document-wide mutex.

**Attributed conflicts.** A `conflict` result (and a `conflicted` proposal,
as `get_workspace_manifest`'s count and the proposal record show it) carries
`conflictingTargets: string[]` plus `conflicts[]`, one entry per target
naming the **last** committed write behind it:

```json
{
  "ok": false,
  "code": "conflict",
  "revision": 46,
  "message": "proposal overlaps changes committed after its base revision",
  "conflictingTargets": ["page/p1/element/nodes/dmarc/field/label"],
  "conflicts": [
    {
      "target": "page/p1/element/nodes/dmarc/field/label",
      "revision": 46,
      "operationId": "ui_accept_ef46ee02-…",
      "proposalId": "pr_d26e6a4a91364b4b",
      "author": { "kind": "agent", "id": "…", "label": "octocat" },
      "operationType": "element.patch",
      "value": "DMARC"
    }
  ]
}
```

`value` is the committed `set` value for a field target (omitted for
removals, adds, reorders and values over 4 KiB). A patch that sets a field to
the value the last committed write already set is not a conflict: identical
writes commute and the target is not listed.

**Same-author supersede.** `propose_workspace_changes` and
`apply_workspace_changes` accept `supersede: true`. When every conflicting
target was last written by your own earlier work — an accepted proposal of
yours or your own leased commit — and none collides with a `page.remove` /
`element.remove`, the batch is rebased onto the current revision and your
values replace the earlier ones; the `ok` result carries `rebased: true` and
`superseded: [targets]`. A proposal submitted with `supersede` is stored as
pending (with `superseded` listing the targets) and the browser's accept
honours the flag; the browser owner can also choose **Accept · supersede** on
a conflicted proposal whose conflicts are all the agent's own. Anything last
written by someone else, including the owner's direct edits, still conflicts
and must be resubmitted against the current revision.

## Live fabric data (optional)

The _(live-data)_ tools above are registered only when a `TopologyProvider`
is wired in — they read an SD-WAN fabric (appliances, underlay/overlay
tunnels, overlay policies, and flow tables incl. recently-ended flows) so an
agent can build topologies from reality instead of from prose. Credentials
come from the environment only; they never pass through tool arguments.

### Blast radius

The Orchestrator API key is deployment-wide. When live-data is enabled,
**every authenticated MCP session** on that Worker (any GitHub user who
completes OAuth) can call the full fabric tool set against the connected
Orchestrator — inventory, overlay policies, and flow tables — unless the
optional `LIVE_DATA_GITHUB_IDS` allowlist further restricts the grant.
There is no per-session or per-tool credential: one key covers the whole
fabric. Staging and production must never share `ORCH_*` credentials.
Prefer a least-privilege, non-production Orchestrator key. Do not
provision production fabric credentials without an explicit human
decision. See [`../../docs/DEPLOYMENT_RUNBOOK.md`](../../docs/DEPLOYMENT_RUNBOOK.md)
§"Live-data fabric tools".

Secret presence alone does **not** enable the tools. `LIVE_DATA_ENABLED`
must be the literal `"true"` (opt-in, same fail-closed style as
`PROFILES_ENABLED` / `ANALYTICS_ENABLED`). Unset, `"false"`, or a typo
leaves the tools unregistered even if `ORCH_BASE_URL` and `ORCH_API_KEY`
are configured.

- **stdio:** set `LIVE_DATA_ENABLED=true` plus `ORCH_BASE_URL` +
  `ORCH_API_KEY` (EdgeConnect Orchestrator origin + API key) in the
  server's environment, or `TOPOLOGY_PROVIDER=mock` for a built-in
  fixture fabric (demo / development with zero fabric access; the mock
  path does not require the flag).
- **Cloudflare:** set `LIVE_DATA_ENABLED` to `"true"` in that
  environment's `wrangler.jsonc` vars, the `ORCH_BASE_URL` var, and the
  **`ORCH_API_KEY` dashboard secret** (same pattern as
  `GITHUB_CLIENT_SECRET`). Optionally set `LIVE_DATA_GITHUB_IDS` to a
  comma-separated list of GitHub numeric ids (the same identity
  `ADMIN_GITHUB_ID` uses). Both production and staging leave
  `LIVE_DATA_ENABLED` `"false"` until an operator activates them.

The EdgeConnect provider (`src/connect/edgeconnect.ts`) talks only to the
**Orchestrator** — appliance flow tables are read through its appliance-API
proxy, so one key covers the whole fabric and gateways are never contacted
directly.

## Layout quality

For well-organized, overlap-free results, read `layout_guidelines` before
choosing coordinates — it returns the quantitative rules (grid step, minimum
node gap, edge margin, zone padding) plus prose guidance. `validate_topology`
checks against those same rules and reports any overlapping/crowded nodes,
labels, or zones and off-page elements as **warnings** (advisory — they never
block rendering), alongside the semantic checks.

To arrange a topology you haven't placed (or placed badly), **`layout_topology`**
runs a real algorithm — `hierarchical` (layered by link direction), `grid`,
`circular`, or `force` (force-directed) — then a tidy finisher. `tidy_topology`
is the lighter pass that only nudges existing positions. In the editor, the
**arrange…** dropdown runs the same algorithms.

When a generated layout has issues, **`tidy_topology`** resolves them
automatically: it snaps nodes to the grid, pushes apart overlapping/crowded
nodes, and keeps them inside the page (zones auto-resize around their tidied
members). A typical agent loop is generate → `validate_topology` →
`tidy_topology` / `balance_topology` → `inspect_render` → `render_svg`. In the
editor, the **Tidy** button (`T`) runs the same pass on the current frame.

### Hardware catalog (bind, assign, validate)

Where the server has the hardware catalog (the stdio server and the Worker
both do), five tools work with real hardware models and `validate_topology`
checks cabling against them. A typical wire-sheet loop is `list_hardware` →
`bind_hardware` per node → `add_link` → `assign_interfaces` (review the
plan) → `assign_interfaces apply:true` → `validate_topology` →
`export_topology format:"cable-schedule"`.

| Tool                | Input                                                                                       | Returns                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_hardware`     | `query?` (id / name / family / SKU), `vendor?`, `family?`, `category?`, `limit?` (20, ≤100) | `catalogVersion`, `total`, `models[]`: `model`, `name`, `category`, `skus`, `portSummary` ("24x RJ45 1G + 4x SFP56 1-50G"), `confidence`, `gaEligible`                                                             |
| `describe_hardware` | `model`                                                                                     | Summary fields plus `interfaces[]` (`role`, `kind`, `cage`, `speeds`, `count`, `names` like `{member}/1/1-24`, `tiers`), `stackable`, `bondGroups`, `provenanceTiers`, `todo`. No geometry, no provenance sources. |
| `bind_hardware`     | `topologyId`, `nodeId`, `pageIndex?`, `model`, `sku?`, `stackMembers?`, `face?`             | `hw`, `type` (+ `previousType`), `catalogVersion`, `pinned`, and `problems` on that node's cables                                                                                                                  |
| `assign_interfaces` | `topologyId`, `linkIds?`, `strategy?` (`by-role` default / `first-free` / `keep`), `apply?` | `assignments[]` (`page`, `linkId`, `end`, `node`, `interface`, `why`, `replaced?`), `unassigned[]`, `remainingErrors[]`, `applied`                                                                                 |
| `catalog_diff`      | `topologyId`, `toVersion?` (default latest)                                                 | `models[]` (`unchanged` / `changed` with `fields`, `interfacesAdded` / `Removed` / `removed`), `newFindings`, `clearedFindings`, `linksNowFailing`                                                                 |

`gaEligible: false` means the model's data is reseller-only or inferred:
do not present it as confirmed. `confidence: "schematic"` panels are
badged wherever they are drawn. `assign_interfaces` never picks optics (what
is in a cage is a site fact); a cage pick says "declare the optic". Its
`by-role` heuristics: wan toward clouds / ISPs / modems (and unbound routers
or labels like "ISP", "MPLS", "LTE"), lan toward the inside, ha toward a
same-category peer, members of a bond group for a bundle named like the
group, cage uplinks on switches toward network gear, copper access ports
toward endpoints, and copper facing a fixed copper port.

Bound nodes carry `hw: { model, sku?, stackMembers?, face? }`; links name
interfaces and optics (`fromInterface` / `toInterface` / `fromOptic` /
`toOptic`, also on `add_link`). `validate_topology` then checks cabling
page by page, for endpoints on bound nodes only:

- `E_*` rule codes (unknown port, member range, non-data port, port reused,
  optic / cage / media / fiber / speed mismatches, bond pairs, LACP, mixed
  bond speeds) join `problems` as errors with a `code`, so `valid` is false.
- `W_*` (`W_OPTIC_UNDECLARED`, `W_INTERFACE_UNASSIGNED`,
  `W_CATALOG_UNAVAILABLE`) come back in a new `warnings` array, `I_*`
  (`I_SCHEMATIC_PANEL`) in `notes`; neither affects `valid`.
- `catalogVersion` is the catalog bundle judged against: the document's
  pinned `catalogVersion`, else the latest.

A bond is a lag bundle: the link ends on one bound node that name the same
lag bundle (`fromBundle` / `toBundle`); `define_bundle` `lacp` sets LACP for
every node it spans or per node. The rule codes are a contract shared with
`catalog/tools/ref_validate.py` and pinned by `catalog/fixtures/wiring/`.
Documents with no bindings return exactly `valid`, `problems` and
`layoutClean`, as before.

## Visual QA (`inspect_render`)

`validate_topology` checks semantics and layout rules; it cannot tell you
whether the **rendered page reads well**. `inspect_render` closes that gap
without the SVG payload: it estimates the drawn geometry (glyphs, labels, link
label chips, zone boxes) from the renderer's own metrics and returns a compact
report — page/viewBox vs content bounds and margins, crop/clipping problems,
text-legibility findings (labels overflowing nodes or colliding with
neighbours; link, flow-path and marker label pills colliding with each other,
with nodes or with zone titles after the renderer's own collision nudge; links
drawn through a zone title; zone labels overlapped by content; 24-character
truncation of node labels, and marker labels past 24 characters that wrap to
two lines), routing quality (link/link crossings, links through
unrelated node boxes, degenerate link/flow geometry), and density/balance
signals (overlaps, crowding clusters, unbalanced whitespace). Findings are
severity-tagged (`problem` vs `note`) and capped per category with true totals
in `counts`, so the report stays a few KB. Inspect one page per call
(`pageIndex`, default `0`). Use it as the cheap final visual QA step after
validate/tidy/balance and **before** `render_svg` / `share_topology` /
`export_flipbook`; only render once the report is clean.

The tool handlers live in `tools.ts` (pure, unit-tested in `tools.test.ts`);
`server.ts` registers them with the SDK and maps results to MCP text content.

## Rate limits and export size

Remote (Cloudflare) deployments enforce application-level quotas so a retry
loop cannot amplify Durable Object / KV cost or stuff an agent context with
unbounded SVG/HTML. The local stdio server has no per-user identity and does
not apply the request quotas; it still enforces the export size caps. These
are the request-rate complement to the coordinator's batch (250 ops / 512 KiB)
and page-size limits.

On a rate-limited tool call the handler returns `isError` with a message of
the form `rate limited (<bucket>: <n> per <window>s). Retry after <seconds>s.`
Wait at least that many seconds before retrying the same class of call.
Prefer `edit_topology` batches over per-element `add_*` tools — a batch is
one quota unit.

| Surface                                                                                                                                                          | Limit       | Scope                                               | Exceeded                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Mutating MCP tools (authoring writes, `propose_workspace_changes`, `apply_workspace_changes`, `create_checkpoint`, `create_workspace`, `build_flow_topology`, …) | 120 / 60s   | Authenticated GitHub user (registry Durable Object) | Tool error; retry after the stated delay                                           |
| `share_topology`                                                                                                                                                 | 8 / 300s    | Authenticated GitHub user                           | Tool error; retry after the stated delay                                           |
| `render_svg`                                                                                                                                                     | 2 MiB UTF-8 | Per response                                        | Tool error — do not retry the same page; reduce density or `inspect_render` first  |
| `export_flipbook`                                                                                                                                                | 6 MiB UTF-8 | Per response                                        | Tool error — do not retry the same document; `render_svg` individual pages instead |
| Public `GET /api/topology/:id`                                                                                                                                   | 60 / 60s    | Client IP (`CF-Connecting-IP`)                      | HTTP 429 + `Retry-After`; response is not cached                                   |

Read-only MCP tools (`get_topology`, `inspect_render`, `validate_topology`,
workspace/profile reads, live-data inventory, …) are not request-quota'd.
Export tools are bounded by payload size rather than call rate so a single
oversized render fails closed instead of streaming a multi-megabyte string
into the model context.
