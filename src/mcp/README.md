# Topology Dojo MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Topology Dojo's headless authoring + rendering API as tools, so an agent can
build, validate, and render the same topologies the GUI produces. It is a thin
adapter over `src/api` (authoring/validation) and `src/server/render` (headless
SVG) — there are no UI-only capabilities, so everything the editor can express
is reachable here too.

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
2. **KV namespace** `OAUTH_KV` (dashboard → Storage & Databases → KV) — paste its
   id into `wrangler.jsonc` (`kv_namespaces`). This stores grants/tokens.
3. Deploy through the environment-specific runbook. Then connect a client to
   `https://<your-domain>/mcp`; it will run the GitHub sign-in flow
   automatically.

> State note: legacy authoring tools create private drafts in the per-user
> registry. Once the browser hands one into a workspace (or an agent calls
> `get_workspace_manifest` with its id), it is lazily migrated and all further
> writes use workspace tools. The old snapshot is retained as migration rollback
> material but stale legacy mutation is refused.

### Share links (`share_topology`)

`share_topology` snapshots the current document into a **KV namespace** and
returns a link that opens it in the browser editor — the way to hand a user a
viewable/shareable result after building. Because the snapshot lives in KV (not
the per-session in-memory store), the link keeps working after the MCP session
ends. The link is `<PUBLIC_BASE_URL>/v/<id>`; opening it loads the snapshot into
the editor (the SPA fetches `/api/topology/<id>`). Snapshots expire after 30 days
unless re-published. This tool is **remote-only** — the local stdio server has no
KV/origin, so it isn't registered there.

One-time setup for the isolated staging environment (use the environment's
actual binding names and record the generated ids in `env.staging`):

```bash
npx wrangler kv namespace create TOPOLOGY_KV --env staging
# Set staging PUBLIC_BASE_URL and the generated namespace id in wrangler.jsonc.
# Provision OAUTH_KV and GITHUB_CLIENT_SECRET independently for staging.
npx wrangler deploy --env staging
```

There is no `npm run deploy` script — a laptop cannot deploy production (finding
L1). `npm run deploy:staging` runs the build, `check-wrangler-env.mjs`, and
`wrangler deploy --env staging` for local staging preflight; the protected
staging/production workflows are the only paths that actually publish a
deployment. See the deployment runbook for production approval, migration
bootstrap, and smoke requirements.

## Model

The local stdio server and the remote private-draft path hold topologies keyed by
an id. The usual draft-building flow is:

1. `create_topology` → returns an `id` (seeded with one empty page).
2. add elements against that id (`add_node`, `add_link`, `add_zone`, …).
3. `validate_topology` → list of problems (empty = valid).
4. `render_svg` → a standalone SVG string.
5. `get_topology` / `import_topology` → round-trip the document JSON, which is
   the portable, canonical contract (server state is just a convenience).

Page targeting: the `add_*` tools default to the **most recently added page**;
pass `pageIndex` to target another. `render_svg` defaults to page `0`.

Call `describe_capabilities` first to discover every node type, link type, and
annotation kind with its editable fields (pass a `topologyId` to include that
document's custom node types).

For a document shared with the browser, use the bounded workspace loop instead:

1. `create_workspace` for a new shared document, or `list_workspaces` to choose
   an existing id (legacy ids are migrated on first access).
2. `get_workspace_manifest` → remember its revision and page ids/counts.
3. If `operationSchemaRevision` changed, call
   `describe_workspace_operations` once and cache the vocabulary.
4. `get_workspace_changes` from the last-seen revision; summaries are the
   default and avoid reloading the document.
5. `get_workspace_elements` only for pages/elements needed by the task.
6. `propose_workspace_changes` → a named operation batch for owner review.
7. Use `apply_workspace_changes` only when the browser explicitly shows a live,
   current-page lease.

The browser's manifest/proposal polling is normal application JSON and is not
automatically placed into model context. Token usage is therefore proportional
to the task's affected region and change summaries, not total document size.

## Tools

| Tool                                                   | Purpose                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `describe_capabilities`                                | Discover node/link/annotation types and their fields                                                      |
| `create_topology`                                      | New document (one empty page)                                                                             |
| `list_templates` / `create_from_template`              | List starter templates; instantiate one as a new document                                                 |
| `list_topologies` / `get_topology` / `delete_topology` | Manage held documents                                                                                     |
| `import_topology`                                      | Load from document JSON (string or object); `format` auto-detects/converts a legacy Topology Studio save  |
| `set_document_title`                                   | Rename a document                                                                                         |
| `add_page` / `set_page_properties`                     | Append a frame; edit an existing page's name / viewBox                                                    |
| `add_node` / `add_link` / `add_anchor`                 | Core elements                                                                                             |
| `add_zone` / `add_flow_path` / `add_policy_marker`     | Annotation layer                                                                                          |
| `update_element` / `remove_element`                    | Patch any element in place; remove (with dependent cleanup)                                               |
| `upsert_by_source`                                     | Converge an element onto external data by source identity                                                 |
| `define_layer`                                         | Declare a document layer (underlay / overlay / policy / service); `opacity` dims the plane                |
| `define_node_type`                                     | Add a custom node type (merged over defaults)                                                             |
| `set_node_metadata`                                    | Attach k/v metadata to a node (serial, version, hostname, site…)                                          |
| `set_legend`                                           | Toggle + position the auto-generated symbol legend / key                                                  |
| `set_palette`                                          | Brand palette — recolour canvas accents + chrome (hex; `clear` resets)                                    |
| `layout_guidelines`                                    | Ground-truth layout rules + prose (read before placing nodes)                                             |
| `validate_topology`                                    | Semantic **and layout** checks (overlaps, crowding, off-page)                                             |
| `tidy_topology`                                        | Auto-arrange: grid-snap + de-overlap + keep in bounds                                                     |
| `balance_topology`                                     | Tidy then align rows/columns + centre (the crisp finishing pass)                                          |
| `layout_topology`                                      | Arrange from scratch (hierarchical / grid / circular / force)                                             |
| `render_svg`                                           | Render a page to a standalone SVG string (`visibleLayers` filters)                                        |
| `export_flipbook`                                      | Standalone self-playing HTML of all pages on their durations                                              |
| `describe_data_source` _(live-data)_                   | Identify the connected fabric data source                                                                 |
| `list_appliances` / `list_tunnels` _(live-data)_       | Inventory: appliances; underlay / overlay tunnels                                                         |
| `get_overlay_policies` _(live-data)_                   | Overlay / business-intent policy definitions                                                              |
| `list_flows` / `get_flow_details` _(live-data)_        | Query fabric flow tables (active + ended); per-flow detail                                                |
| `build_flow_topology` _(live-data)_                    | One shot: fabric + flows → layered, animated, tidy document                                               |
| `share_topology`                                       | Publish a durable snapshot; returns a browser link (remote-only)                                          |
| `create_workspace`                                     | Create a canonical shared document directly, bypassing the legacy draft path                              |
| `list_workspaces`                                      | List canonical workspaces and legacy drafts without document contents                                     |
| `get_workspace_manifest`                               | Compact revision/page/count/proposal/lease status; lazily migrates a legacy id                            |
| `describe_workspace_operations`                        | On-demand versioned operation vocabulary; call only when its revision changes                             |
| `get_workspace_changes`                                | Bounded summaries or exact operations since a revision                                                    |
| `get_workspace_elements`                               | Targeted, paginated element hydration for one page                                                        |
| `propose_workspace_changes`                            | Submit a semantic change set for browser-owner review (default write path)                                |
| `apply_workspace_changes`                              | Direct semantic commit only inside a live UI-granted page lease                                           |
| `create_checkpoint`                                    | Snapshot the workspace as a named checkpoint (restore/fork stay browser-owner)                            |
| `list_checkpoints`                                     | List named checkpoints (id, name, revision, page count, author)                                           |
| `get_authoring_guidance`                               | Owner-confirmed preferences + product guidance for this task (≤5 rules, hard token budget, `notModified`) |
| `list_authoring_preferences`                           | Compact read-only summaries of the owner’s learned preferences                                            |
| `explain_authoring_preference`                         | One rule’s scope, trigger, rationale, confidence, and evidence counts (read-only)                         |

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

## Live fabric data (optional)

The _(live-data)_ tools above are registered only when a `TopologyProvider`
is wired in — they read an SD-WAN fabric (appliances, underlay/overlay
tunnels, overlay policies, and flow tables incl. recently-ended flows) so an
agent can build topologies from reality instead of from prose. Credentials
come from the environment only; they never pass through tool arguments.

- **stdio:** set `ORCH_BASE_URL` + `ORCH_API_KEY` (EdgeConnect Orchestrator
  origin + API key) in the server's environment, or `TOPOLOGY_PROVIDER=mock`
  for a built-in fixture fabric (demo / development with zero fabric access).
- **Cloudflare:** set the `ORCH_BASE_URL` var and the **`ORCH_API_KEY`
  dashboard secret** (same pattern as `GITHUB_CLIENT_SECRET`).

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
`tidy_topology` → `render_svg`. In the editor, the **Tidy** button (`T`) runs the
same pass on the current frame.

The tool handlers live in `tools.ts` (pure, unit-tested in `tools.test.ts`);
`server.ts` registers them with the SDK and maps results to MCP text content.
