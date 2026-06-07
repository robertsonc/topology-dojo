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
Worker (`worker/index.ts`), alongside the static app. Each MCP session is a
Durable Object (`TopologyMcp`) holding that session's in-memory `TopologyStore`;
the renderer is the same engine-agnostic core, with the vendored engine bundled
instead of `require`d. Auth is a **single shared secret** via
`Authorization: Bearer <key>`.

Deploy (on your Cloudflare account):

```bash
npx wrangler secret put MCP_API_KEY   # set the shared bearer secret once
npm run deploy                        # npm run build && wrangler deploy
```

> **Deploy command must be `wrangler deploy`, not `wrangler versions upload`.**
> This Worker declares a Durable Object **migration** (to create `TopologyMcp`),
> and migrations can only be applied by a full, non-versioned `wrangler deploy`
> (`versions upload` fails with error 10211). In the Workers Builds project
> settings, set the **Deploy command** to `npx wrangler deploy`. (Once the v1
> migration is applied, the DO class exists; only a _new_ migration would need
> another full deploy.)

After deploy, connect a client to `https://<your-worker-domain>/mcp` with header
`Authorization: Bearer <key>`.

> State note: a session's topology lives in the Durable Object's memory for the
> session's lifetime; export with `get_topology` if you need to persist it. Auth
> is intentionally minimal (one shared key) — graduate to per-key KV or OAuth if
> you need multiple/revocable credentials.

## Model

The server holds topologies in memory, keyed by an id. The usual flow:

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

## Tools

| Tool                                                   | Purpose                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `describe_capabilities`                                | Discover node/link/annotation types and their fields          |
| `create_topology`                                      | New document (one empty page)                                 |
| `list_topologies` / `get_topology` / `delete_topology` | Manage held documents                                         |
| `import_topology`                                      | Load from document JSON (string or object)                    |
| `add_page`                                             | Append a frame                                                |
| `add_node` / `add_link` / `add_anchor`                 | Core elements                                                 |
| `add_zone` / `add_flow_path` / `add_policy_marker`     | Annotation layer                                              |
| `define_node_type`                                     | Add a custom node type (merged over defaults)                 |
| `layout_guidelines`                                    | Ground-truth layout rules + prose (read before placing nodes) |
| `validate_topology`                                    | Semantic **and layout** checks (overlaps, crowding, off-page) |
| `tidy_topology`                                        | Auto-arrange: grid-snap + de-overlap + keep in bounds         |
| `render_svg`                                           | Render a page to a standalone SVG string                      |

## Layout quality

For well-organized, overlap-free results, read `layout_guidelines` before
choosing coordinates — it returns the quantitative rules (grid step, minimum
node gap, edge margin, zone padding) plus prose guidance. `validate_topology`
checks against those same rules and reports any overlapping/crowded nodes,
labels, or zones and off-page elements as **warnings** (advisory — they never
block rendering), alongside the semantic checks.

When a generated layout has issues, **`tidy_topology`** resolves them
automatically: it snaps nodes to the grid, pushes apart overlapping/crowded
nodes, and keeps them inside the page (zones auto-resize around their tidied
members). A typical agent loop is generate → `validate_topology` →
`tidy_topology` → `render_svg`. In the editor, the **Tidy** button (`T`) runs the
same pass on the current frame.

The tool handlers live in `tools.ts` (pure, unit-tested in `tools.test.ts`);
`server.ts` registers them with the SDK and maps results to MCP text content.
