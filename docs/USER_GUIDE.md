# Topology Dojo User Guide

**Last reviewed:** 2026-08-09

Topology Dojo is a studio for building network-topology diagrams. A person can
edit a diagram directly on the canvas, or an MCP-capable agent can author the
same document model through tools. The browser and agent paths use the same
nodes, links, annotations, pages, validation rules, layouts, and renderers.

This guide describes the behavior implemented in this repository. A hosted
deployment can disable workspaces, authoring preferences, analytics, or live
fabric connectivity. If a control or tool described here is absent, first check
whether the deployment has enabled that feature.

For product principles and technical details, see the
[README](../README.md), [design guide](DESIGN.md),
[architecture](ARCHITECTURE.md), and [MCP guide](../src/mcp/README.md).

## 1. Choose the right surface

Topology Dojo has several related but distinct surfaces.

| Audience                    | Surface                 | Best for                                                                    | Important distinction                                                                                                                                  |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diagram author              | Hosted browser editor   | Interactive drawing, review, export, and shared-workspace ownership         | The main editor requires GitHub sign-in. A normal browser draft still autosaves locally until it is handed off to a workspace.                         |
| Diagram author or developer | Local browser editor    | Local editing and development                                               | Runs through Vite without hosted authentication or Worker-backed workspace, profile, admin, and share services.                                        |
| Link recipient              | Public shared-copy view | Reviewing or adapting an agent-published snapshot                           | No sign-in is required. The link is public, and edits go to a separate browser-local copy.                                                             |
| Agent operator              | Local MCP server        | Local or development-time agent authoring                                   | Uses stdio. Its private draft state is process-local, and it cannot publish hosted share links.                                                        |
| Agent operator              | Hosted MCP endpoint     | Durable private drafts, public snapshot publishing, and authenticated tools | Uses OAuth with GitHub at the deployment's **/mcp** endpoint.                                                                                          |
| Human owner and agent       | Agent Workspace         | Revisioned collaboration on one canonical document                          | Agents are **Suggest only** by default. The browser owner reviews proposals and controls direct-write leases.                                          |
| Deployment owner            | Admin dashboard         | Login and workspace metadata                                                | Available only when analytics is enabled and the signed-in GitHub numeric ID matches the configured administrator. It never displays diagram contents. |

### The document model

A document contains an ordered list of pages. Each page is a complete topology
frame, not a delta from the previous page. A page can contain:

- nodes;
- links;
- free-floating anchors used as link endpoints;
- zones;
- flow paths;
- policy markers;
- a caption, emphasis selection, hold duration, and cut or fade transition.

The document also carries custom node definitions, reusable stencils, layers, a
legend setting, and an optional brand palette. Duplicating a page deep-copies
the page so it can be edited independently.

## 2. Getting started

### Hosted editor and GitHub sign-in

1. Open the deployment's base URL.
2. Select **Sign in with GitHub**.
3. Complete GitHub authorization. Topology Dojo requests the **read:user**
   scope to identify the owner of drafts and workspaces.
4. After the editor opens, the account chip shows the GitHub login. Open it to
   see **Signed in as** and **Sign out**.

Signing out clears the hosted browser session but does not intentionally erase
the document autosaved in that browser.

The hosted login page is open to GitHub accounts unless a particular deployment
adds an external access policy. Public **/v/** share links bypass the main
editor login gate.

### Local browser editor

From the repository root:

    npm ci
    npm run dev

Open **http://localhost:5173**. Local Vite development bypasses the Worker login.
The account, Agent Workspace, Authoring Preferences, Admin dashboard, remote
MCP, and public-share services are not available through Vite alone.

Useful local commands are:

    npm run dev
    npm run build
    npm test
    npm run lint
    npm run test:e2e

The automated browser release gate currently targets Desktop Chrome through
Playwright. The repository does not declare a broader supported-browser or
touch-editing matrix.

### Local MCP server

Install the locked dependencies, then start the stdio server:

    npm ci
    npm run mcp

Configure the MCP client to launch that command in the repository. The local
server exposes the document-authoring tools described in
[MCP workflows](#16-mcp-and-agent-workflows). Local private drafts live only for
the life of the server process unless the agent exports their JSON.

### Hosted MCP endpoint

Configure an MCP-compatible client with:

    https://<deployment-domain>/mcp

Compatible clients use the endpoint's OAuth discovery and dynamic client
registration. The user is redirected to GitHub; there is no application token
to paste into an ordinary client setup. Hosted MCP drafts are isolated by the
authenticated GitHub identity.

Deployment owners setting up OAuth, staging, secrets, and Durable Objects
should use the [MCP deployment guide](../src/mcp/README.md) and
[deployment runbook](DEPLOYMENT_RUNBOOK.md).

## 3. Where data lives

GitHub sign-in alone does not move the open canvas into a canonical server
workspace. Use this table when deciding whether a diagram is recoverable,
shared, or public.

| Data                                      | Storage location                                                            | Who can reach it                                                      | Retention and recovery                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal browser draft                      | Browser localStorage on the current browser/profile                         | The person using that browser profile                                 | Autosaves after edits. It remains local across refresh and sign-out, subject to browser storage policy, clearing, quota, and device loss. Use **download** for a portable backup.                   |
| Shared-link working copy                  | A separate browser localStorage slot                                        | The person who opened the public link                                 | It does not overwrite the normal local draft. Refresh resumes the shared copy. Choose **keep this copy** to adopt it or **back to my document** to discard it from the canvas.                      |
| Downloaded JSON                           | A file chosen by the browser                                                | Anyone who receives the file                                          | Full portable document backup under the user's control.                                                                                                                                             |
| Local MCP private draft                   | Memory in the local MCP process                                             | The connected local MCP client                                        | Treat as temporary. Export or retrieve the JSON before stopping the process.                                                                                                                        |
| Hosted MCP private draft                  | Per-user hosted registry                                                    | The authenticated GitHub owner and that owner's MCP session           | No user-facing automatic expiry is documented. The browser owner can open or hand the draft into a canonical workspace.                                                                             |
| Canonical Agent Workspace                 | Hosted per-document coordinator                                             | The authenticated owner and authorized tools operating for that owner | Revisioned and server-backed. Recent history can be compacted. Named checkpoints are capped at 12.                                                                                                  |
| Workspace offline cache and pending queue | IndexedDB in the current browser plus a lightweight local workspace pointer | The person using that browser profile                                 | Supports reload and reconnection recovery. Do not clear site data while operations are pending.                                                                                                     |
| Public share snapshot                     | Hosted KV and public **/v/<id>** URL                                        | Anyone with the URL; no login                                         | Each URL expires 30 days after publication. Publishing again creates a new URL; it does not renew the old one. A URL is publicly cacheable for up to 24 hours and has no user-facing revoke action. |
| SVG, PNG, or flipbook export              | Downloaded file or MCP result                                               | Anyone who receives the artifact                                      | Outside Topology Dojo after export. Handle it according to the content's sensitivity.                                                                                                               |
| Authoring preferences                     | Hosted profile store, when enabled                                          | The owner; agents can read confirmed guidance only                    | The owner can confirm, pause, reject, or forget rules.                                                                                                                                              |
| Login analytics                           | Hosted analytics store, when enabled                                        | The configured deployment administrator                               | Login and workspace metadata only; no diagram contents. Collection is going-forward and best-effort.                                                                                                |

The active page number is view state, not part of the document contract. A
reloaded document normally opens on its first page.

## 4. Editor anatomy

The editor is organized into six areas.

1. **Top toolbar.** File actions (including **share** on hosted
   deployments), undo and redo, **svg**, **png**, the **⤓ export…** menu
   (PDF, flipbook HTML, clipboard PNG, selection-only exports), templates,
   drawing tools, view controls (including **▶** Present), layout actions,
   selection actions, and the optional workspace/profile/admin/account chips.
2. **Node library.** A searchable, categorized catalog on the left. It also
   holds document custom nodes and stencils.
3. **Canvas.** The current page, selection overlay, smart guides, link handles,
   problem badges, and zoom/pan controls.
4. **Minimap.** A small overview inside the Node library.
5. **Pages strip.** The filmstrip along the bottom, including playback and page
   management.
6. **Properties and Problems.** A resizable right column. Properties follow the
   selection; Problems shows validation and layout findings.

The status bar reports the active tool, cursor location, element counts, zoom,
history availability, and current error/warning counts.

Use **B**, **M**, **P**, and **F** to toggle the Node library, minimap,
Properties, and pages strip. The palette, filmstrip, minimap, Problems panel,
and Properties panel remember their local display state when browser storage is
available.

Use **Ctrl/Cmd+F** to search node labels, identifiers, types, sublabels, and
metadata keys/values (find a node by the IP address, hostname, or model stored
on it — the result row shows why it matched), then jump to a result. The
minimap provides an overview of content outside the current viewport.

## 5. Build and edit a topology

### A practical first-diagram workflow

1. Choose **new** or select an item from **＋ template…**.
2. Set the document title and page name in Properties while nothing is
   selected.
3. Search the Node library and click node types to add them.
4. Move and label nodes, then connect them.
5. Add zones, flows, markers, layers, and a legend if they help explain the
   topology.
6. Run **tidy**, **balance**, or an **arrange…** algorithm.
7. Review **Problems** and resolve errors or relevant warnings.
8. Add pages, captions, emphasis, and playback timing if the diagram tells a
   sequence.
9. Wait for **✓ saved**, then choose **download** for a portable JSON backup.
10. Export the current frame as **svg** or **png**, or use MCP for a flipbook or
    public share link.

### Add and move nodes

- Type in **Search nodes…** to filter by name, type, category, or known aliases.
- Click a catalog item to add it near the center of the visible page.
- **Double-click empty canvas** to open the quick-add picker: type to filter
  the same catalog, then press Enter (or click) to place that node exactly at
  the double-clicked point.
- **Double-click a node, link, or zone** to rename it in place: a small input
  opens over the element; Enter commits, Escape cancels.
- **Hover a node** to reveal four directional chevrons beyond its connection
  dots. Click one to create a same-type node one step away in that direction,
  already linked back and ready for its label. Drag from a chevron (or a
  connection dot) and release over empty canvas to pick any type for the new
  connected node at the drop point.
- Return to **select** or press **V**, then drag a node to move it.
- Grid snapping and smart alignment/spacing guides help place nodes. Toggle the
  grid with **R** and snapping with **G**.
- Use the arrow keys for a small nudge; hold Shift for a ten-times nudge.
- Lock important items with **Ctrl/Cmd+L** or the context menu so an accidental
  drag does not move them.
- Use **[** and **]** for one-step stacking changes, or add Ctrl/Cmd to send an
  item fully back or front.

When multiple nodes are selected, the toolbar exposes:

- Align left, horizontal centers, right, top, vertical middles, or bottom.
- Distribute horizontally or vertically.
- **select…** actions for **same type**, **same color**, **connected (grow)**,
  **invert**, and **all**.

### Create links

There are two link gestures:

- Select **link** or press **L**, click the source node or anchor, then click a
  different target node or anchor. Clicking empty space cancels the pending
  source.
- In **select** mode, hover a node and drag from one of its connection dots to
  another endpoint.

Select a link to edit its type, labels, endpoint/interface labels, VLAN, subnet,
bandwidth, transport, line color and opacity, routing style, corner radius,
ports, animation, direction, speed, lock state, layer, and source metadata when
those fields apply.

Link routing supports straight, orthogonal, and curved styles. Use
**Swap endpoints** to reverse the endpoints and waypoint order. Use
**Straighten (clear bends)** to remove all manual waypoints.

### Anchors

An anchor is a free-floating endpoint for a link when the route should end or
bend somewhere other than a node.

1. Choose **anchor** or press **A**.
2. Click the page to place the anchor.
3. Use the link tool to connect a node or another anchor to it.
4. Return to **select** to move it or edit its X/Y position in Properties.

Deleting an anchor also cleans up dependent references according to the
document's cascade rules.

### Edit waypoints and labels

1. Select a link. Its waypoint handles and midpoint **＋** handles appear.
2. Drag an existing waypoint to move a bend.
3. Drag a segment midpoint **＋** handle to insert a new waypoint.
4. Double-click a waypoint to remove that bend.
5. Choose **Straighten (clear bends)** to remove every bend.

The link's center label and endpoint/interface labels can be dragged
independently. Alignment guides appear while moving labels.

### Select, copy, format, and delete

- Click an item to select it.
- Shift-click to add to or remove from the selection.
- Drag on empty canvas in **select** mode to marquee-select.
- Use **Ctrl/Cmd+A** to select all.
- Use **Ctrl/Cmd+C**, **X**, and **V** for copy, cut, and paste.
- Use **Ctrl/Cmd+D** to duplicate.
- Copy only appearance with **Ctrl/Cmd+Alt+C**, then select compatible targets
  and use **Ctrl/Cmd+Alt+V**. The Properties panel also shows **copy** and
  **paste** buttons in its **Format** row.
- Delete with Delete/Backspace or the toolbar **delete** action.

Format painting copies visual fields, not element identity, endpoints,
waypoints, or labels. Deleting a node or anchor also removes or repairs
dependent links, marker targets, zone memberships, and flow routes so normal
editing does not leave avoidable dangling references.

Undo and redo are available from the toolbar or with **Ctrl/Cmd+Z** and
**Ctrl/Cmd+Shift+Z**. Each page keeps its own edit history when switching
between pages. Page deletion has its own short-lived **↩ undo delete** action in
the filmstrip.

### Context menus

Right-click a node selection for:

- **Duplicate**, **Copy**, **Copy format**, and **Paste format**;
- **Emphasize on this frame**;
- **Group into zone**, **Save as stencil…**, and **Add policy marker**;
- **Bring to front**, **Send to back**, **Lock** or **Unlock**, and **Delete**.

Right-click a link for:

- **Swap endpoints** and **Straighten (clear bends)**;
- format painting and frame emphasis;
- stacking, lock, and delete actions.

Right-click empty canvas for **Paste**, **Select all**, **Tidy layout**,
**Balance layout**, and **Fit page to content**.

Context menus support Up/Down, Enter, and Escape. Dialogs and menus keep Tab
focus inside the open overlay and restore focus when closed.

### Keyboard reference

| Keys                               | Action                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| V                                  | Select / move                                                                 |
| L                                  | Draw link                                                                     |
| A                                  | Drop anchor                                                                   |
| Space or H                         | Hand tool; drag to pan                                                        |
| Ctrl/Cmd+Z                         | Undo                                                                          |
| Ctrl/Cmd+Shift+Z or Ctrl+Y         | Redo                                                                          |
| Ctrl/Cmd+C, X, V                   | Copy, cut, paste                                                              |
| Ctrl/Cmd+Alt+C                     | Copy format                                                                   |
| Ctrl/Cmd+Alt+V                     | Paste format onto the selection                                               |
| Ctrl/Cmd+D                         | Duplicate                                                                     |
| Ctrl/Cmd+L                         | Lock or unlock                                                                |
| Delete or Backspace                | Delete selection                                                              |
| [ or ]                             | Send back or bring forward                                                    |
| Ctrl/Cmd+[ or Ctrl/Cmd+]           | Send to back or bring to front                                                |
| Ctrl/Cmd+A                         | Select all                                                                    |
| Shift-click                        | Add to selection                                                              |
| Arrow keys                         | Nudge; Shift makes the step ten times larger                                  |
| Left/Right Arrow with no selection | Move to the previous or next page                                             |
| Mouse wheel                        | Zoom toward the cursor                                                        |
| Space-drag or middle-drag          | Pan                                                                           |
| 0                                  | Fit to content                                                                |
| Ctrl/Cmd+F                         | Find and jump to a node (labels, ids, types, metadata)                        |
| Double-click node/link/zone        | Rename in place (Enter commits, Escape cancels)                               |
| Double-click empty canvas          | Quick-add: type to pick a node type, Enter places it                          |
| Ctrl/Cmd+click                     | Follow an element's hyperlink (when `href` is set)                            |
| Pinch / two-finger drag (touch)    | Zoom about and pan with the gesture                                           |
| R                                  | Toggle grid                                                                   |
| G                                  | Toggle snap                                                                   |
| M or P                             | Toggle minimap or Properties                                                  |
| B                                  | Toggle Node library                                                           |
| F                                  | Toggle pages strip                                                            |
| C                                  | Calm Canvas                                                                   |
| T                                  | Tidy layout                                                                   |
| Shift+T                            | Balance layout                                                                |
| ?                                  | Open the shortcut reference                                                   |
| Escape                             | Close the topmost dialog/menu; otherwise clear selection and return to Select |

Canvas shortcuts are suppressed while typing in an input and while a dialog or
menu owns focus.

## 6. Node library and Properties

### Built-in library

The built-in library covers:

- network and edge devices such as EdgeConnect appliances, switches, routers,
  firewalls, access points, clouds, hosts, and connectors;
- application and infrastructure symbols such as apps, SaaS, servers,
  databases, identity cards, and text boxes;
- generic geometric shapes;
- an **Image** entry that opens a file picker: the picture is downscaled to a
  compact data URI (≤256KB), embedded in the document, and placed sized to its
  aspect ratio (https image URLs can also be set directly in Properties);
- cloud-specific gateway/router symbols for AWS, Azure, and Google Cloud;
- an **EC + Axis Connector (container)** variant.

Built-in link types include line, tunnel, WireGuard, flow, packet, blocked,
Wi-Fi, PoE, and optical.

### Selection-aware Properties

With nothing selected, Properties shows the document and page settings:

- **Title**, **Name**, **Canvas W**, **Canvas H**, and
  **fit to content**;
- playback **Hold (ms)** and **Transition**;
- **Link crossings** — draw a hop (arc or gap) where standard line links
  cross links drawn earlier, the classic "these wires aren't joined"
  notation;
- frame **Caption** and **Emphasis**;
- legend **Show key** and **Position**;
- document layers.

With a node selected, Properties is catalog-driven. Common fields include
label, sublabel, type, color, opacity, **status** (an operational LED at the
node's corner: OK, warning, down — with an attention ring —, maintenance, or
unknown; in-use statuses join the legend), label color/offset, lock, metadata,
**Link URL** (`href` — Ctrl/Cmd+click follows it in the editor, and SVG
exports and public share views render it as a real clickable link) and
**Tooltip** (shown on hover), layer, and source identity. Type-specific controls add settings such as device variant,
managed/agent state, SaaS logo, switch ports, or text-box typography, fill,
border, alignment, padding, and width.

With a link selected, Properties exposes the link-specific fields described in
[Create links](#create-links), plus **Swap endpoints** and **straighten** where
applicable.

With an anchor or zone selected, Properties focuses its coordinates or zone
membership/settings. All page annotations remain available below the main
selection editor.

## 7. Zones, flows, markers, layers, and legend

### Add annotations

The **Annotations** section in Properties has:

- **＋ zone** — seeds a zone from all currently selected nodes;
- **＋ flow** — seeds an ordered flow path from the selected nodes;
- **＋ marker** — attaches a policy marker to the first selected node.

Select the nodes before creating the annotation. A marker requires a selected
node. A useful flow normally requires at least two ordered waypoints.

### Zones

Zones visually group related nodes. Edit the label, sublabel, description,
member list, color, border, padding, alignment, parent zone, layer, and source
fields as needed.

The membership editor uses chips. Zone membership is node-only:

- **＋ add…** adds a node;
- **‹** and **›** reorder a chip;
- **✕** removes it.

Anchors are valid link endpoints and flow-path waypoints, but not zone members.
If an anchor appears in the generic picker, do not select it; validation treats
that membership as invalid.

The zone actions can select all members so they move together, or duplicate the
zone with its contents. A zone can name a parent zone for nested grouping.

### Flow paths

A flow path is an ordered route through nodes or anchors. The order is the
route. Select nodes in route order before choosing **＋ flow**, or use the chip
editor afterward.

Flow paths support label, color, animation style, dashed/pulse/particle
presentation, speed, direction, width, opacity, layer, source, and optional hop
metadata. Use chip **‹/›** controls to correct the order.

### Policy markers

A policy marker badges a node and can optionally associate with a flow path.
Built-in marker vocabulary includes:

- inspect, allow, deny, redirect, encrypt, decrypt, NAT, load-balance, and log;
- Windows, macOS, Linux, iOS, Android, and ChromeOS;
- agent and agentless;
- DNS, web proxy, captive portal, WAF, CASB, DLP, IPS, sandbox, ZTNA, SSO, MFA,
  and geo-block.

Edit the marker label, color, icon, target node, flow path, and alignment around
the target in Properties.

### Layers

Layers organize related visual planes. Supported kinds are **underlay**,
**overlay**, **policy**, and **service**. The base content remains present
outside declared layers.

While nothing is selected:

1. Open **Layers** in Properties.
2. Choose **＋ Layer** to declare a new layer.
3. Use the eye control to show or hide it.
4. Use the opacity slider to dim the layer.
5. Assign nodes, links, or annotations to the layer from their Properties.

Layer visibility and opacity are document settings and affect rendering.

### Legend

Enable **Show key** and choose top-left, top-right, bottom-left, or bottom-right.
The generated legend travels with supported exports.

## 8. Validation, Problems, and layout

The Problems panel runs the same semantic and layout checks available to MCP
agents. It evaluates all pages and classifies findings as errors or warnings.
Typical findings include missing references, duplicate identifiers, invalid
values, overlap, crowding, and off-page content.

- Expand **Problems** to see details.
- Select a problem to switch to its page and focus the related element when one
  is available.
- Toggle on-canvas problem badges with the warning icon in the toolbar.
- Click a badge to open the related problem.

Rendering is intentionally tolerant of many warnings so a diagram can remain
viewable while the author fixes it. Treat errors as document defects and review
warnings for visual quality.

### Layout actions

- **tidy** or **T**: snap to grid, reduce overlaps, and keep the current page in
  bounds.
- **balance** or **Shift+T**: tidy, align rows/columns, and center the result.
- **arrange…**: rebuild the current page using **hierarchical**, **grid**,
  **circular**, or **force-directed** layout.
- **fit to content**: resize the page around its current content.
- **Fit view** or **0**: change only the viewport so content is visible.

Tidy/Balance can grow the page when needed. Layout operations are undoable.
After any automatic arrangement, review meaningful manual routing and run
Problems again.

## 9. Pages, playback, captions, and emphasis

The pages strip shows the current page number and total.

- Choose **＋ frame** to add a blank page.
- Choose **⧉ duplicate** to deep-copy the current page.
- Double-click a page name to rename it.
- Drag a page chip to reorder pages.
- Use the page **✕** to delete it. The only page cannot be deleted.
- If a page contains nodes, links, annotations, a caption, or emphasis, deletion
  asks for confirmation.
- After deletion, **↩ undo delete** remains available for about eight seconds.
  Only the most recent deleted page is recoverable this way.

### Playback

When a document has multiple pages, choose **▶ play**. Playback loops through
the pages. For each page, set:

- **Hold (ms)** — how long the frame remains visible;
- **Transition** — **cut** or **fade**.

Manual page selection stops playback. During playback, a fade uses a short
visual transition; page hold duration controls when the next frame starts.

### Present mode

Choose the **▶** toolbar button to play the document full-screen: every frame
renders exactly as exports do (caption, legend, emphasis, fade transitions),
looping on each page's hold time. Use **←/→** to step manually, **Space** to
pause/resume autoplay, and **Escape** to exit.

### Captions and emphasis

With nothing selected, use the **Frame** section:

- Enter a **Caption** describing what the frame shows. It appears at the bottom
  of the frame and travels with supported exports.
- Tick nodes and links under **Emphasis** to spotlight them while other elements
  dim.
- Use **Clear emphasis** to restore equal prominence.

You can also select elements, right-click, and choose
**Emphasize on this frame**.

## 10. Starter templates

The **＋ template…** menu creates a new document from one of six built-in
templates:

- **Three-tier web app**;
- **SD-WAN branch**;
- **ZTNA user-to-app**;
- **Firewall + DMZ**;
- **Spine-leaf fabric**;
- **Hub and spoke**.

Starting from a template replaces the active canvas after confirmation. Download
the current JSON first if it must be retained. A connected Agent Workspace must
be closed before replacing the document.

## 11. Save, import, export, and share

### Browser autosave and JSON

Browser edits save after a short debounce. The status area reports:

- **✓ saved** for the normal browser-local draft;
- **✓ saved · shared copy** for an opened public snapshot;
- **⚠ not saved — download JSON** if browser storage is full or unavailable.

If storage fails, click the warning or focus it and press Enter/Space to download
the full JSON immediately.

Use the file controls:

- **new** creates a blank one-page document after confirmation;
- **download** saves the full document as JSON;
- **open** loads a Topology Dojo or recognized legacy JSON file.

Opening a file, starting a new document, or choosing a template replaces the
active canvas. Export first when in doubt.

### Legacy Topology Studio import

The browser and MCP **import_topology** tool can recognize a legacy Topology
Studio save and convert it. Conversion is best effort, not a byte-for-byte
migration.

The browser shows a summary and up to the first eight warnings before loading.
Depending on the source document, legacy subtitle, act/choreography, glossary,
blocked-phase, unknown-type, and unsupported presentation details can be
renamed, approximated, or omitted. Review every converted page, Problems,
annotations, and exports before relying on the result.

Native files with validation errors can still load after an issue summary so
they can be repaired.

### SVG

Choose **svg** to download the current frame as standalone vector SVG. The
export includes the current layer presentation, frame emphasis, legend, and
caption. Calm Canvas affects animated presentation in the SVG.

### PNG

Choose **png** to download the current frame as a two-times static raster. PNG
export runs in the browser; there is no server/MCP PNG tool.

### PDF, clipboard, and selection exports

The **⤓ export…** toolbar menu adds:

- **PDF — current frame** and **PDF — all frames** (one multi-page PDF, each
  page sized to its frame). PDF export rasterizes at 2× through the same
  pipeline as PNG, so it always matches the canvas.
- **Copy PNG to clipboard** (also on the right-click menu as **Copy as
  image** for a selection and **Copy frame as image** on empty canvas).
- **SVG — selection only** and **PNG — selection only**: a cropped export of
  just the selected nodes and the links between them.

### Flipbook HTML

The **⤓ export… → Flipbook HTML** toolbar action (and the MCP
**export_flipbook** tool — both use the same generator) returns a
self-contained HTML presentation of all pages. It includes page timing,
cut/fade behavior, looped play/pause, and page navigation.

### Mermaid and CSV import

The **open** dialog also accepts:

- **Mermaid flowcharts** (`.mmd`, or any text starting with `flowchart …` /
  `graph …`): nodes (shape brackets map to the closest vocabulary — `[(x)]`
  becomes a database, `{x}` a diamond, and so on), edges with labels,
  `subgraph … end` blocks as zones. The result is auto-laid-out following the
  diagram's direction. Unsupported syntax is skipped with warnings shown in
  the confirm summary.
- **CSV data**: either `[nodes]` / `[links]` sections (headers `id`, `label`,
  `type`, `zone`, `x`, `y`, `meta.*` and `from`, `to`, `type`, `label`,
  `vlan`, …) or a bare `from,to` edge list (endpoints become hosts). Unknown
  types fall back to host/line with line-numbered warnings.

The MCP **import_topology** tool accepts the same text formats via
`format: "mermaid" | "csv"` (or auto-detection).

### Public share links

On a hosted deployment, the **share** toolbar button (shown after sign-in)
opens the Share dialog: publish the current document, copy the fresh link,
and see every live link you have published — each with **copy** and
**revoke**. Revoking deletes the public snapshot; edge caches can serve it
for up to about five more minutes. Links published before revocation existed
cannot be listed or revoked and expire on their original schedule.

Agents can do the same over MCP: **share_topology** publishes,
**list_shares** enumerates the owner's live links, and **revoke_share**
takes one down.

The hosted, remote-only MCP **share_topology** tool publishes a snapshot and
returns:

    https://<deployment-domain>/v/<id>

The link:

- is public and requires no sign-in;
- represents the document at publication time, not a live workspace;
- expires after 30 days; publishing again creates a different snapshot and URL
  and does not extend the old URL;
- can remain in browser or edge caches for up to about five minutes;
- can be revoked early from the Share dialog or the **revoke_share** MCP tool.

Do not publish internal addresses, credentials, sensitive metadata, or policy
details unless they are approved for public access for that retention period.

When a recipient opens the link, the banner says
**Viewing a shared copy — your own document is untouched.** Their edits
autosave separately. They can:

- choose **keep this copy** to replace their normal browser-local draft after
  confirmation;
- choose **back to my document** to return to their prior local draft;
- choose **download** first to keep both as files.

## 12. Custom nodes and stencils

### Node Designer

Choose **＋ design node** at the bottom of the unfiltered Node library. The Node
Designer provides a live preview and supports:

- type name and base shape/icon;
- fill, stroke, size, stroke width, and corner settings;
- glow, highlight, inner ring, antenna, and pattern options;
- LEDs, badge, and ports.

Save the definition to add it to the current document's Node library. Use the
pencil control beside a custom type to edit it. Existing nodes of that type
refresh when the definition changes. Custom definitions are part of the
document JSON and therefore travel with JSON, workspace, share, and compatible
render paths.

The Designer also offers a copyable self-contained definition for reuse through
the document/API contract.

### Stencils

A stencil is a reusable group of selected nodes and the links internal to that
selection.

1. Select one or more nodes.
2. Choose **＋ save stencil** in the Node library or
   **Save as stencil…** in the context menu.
3. Name the stencil.
4. Click its thumbnail under **Stencils** to stamp a fresh copy centered on the
   current page.
5. Use the stencil **✕** to remove the saved definition.

Stamped nodes and links receive fresh identifiers. Stencils belong to the
document, not to a global account library.

## 13. Display and accessibility

### View preferences

These controls are local view preferences:

- light/dark theme;
- grid and snap;
- **Calm canvas**;
- on-canvas problem badges;
- **Display settings** for **Ambient backdrop** and **Panel blur (glass)**;
- panel visibility and sizing.

In **Display settings**, Ambient backdrop can be **Animated**, **Static**, or
**Off**. Turning it off removes decorative drifting bits, scan lines, and radar.
Flow particles are separate; **Calm canvas** pauses glow and flow animation.

If no Calm preference has been stored, the editor follows the operating
system's reduced-motion preference. The user can still toggle Calm afterward.

On a touch screen or trackpad, a two-finger pinch zooms about the gesture's
midpoint and a two-finger drag pans; single-finger editing is unchanged. Full
mobile editing remains undeclared (see the limitations section).

### Brand palette

The same Display settings panel includes document-level brand palettes:
**Default**, **Azure**, **Violet**, **Amber**, **Crimson**, **Teal**, and
**Slate**, plus custom **Accent**, **Secondary**, and **Chrome (UI)** colors.

Unlike ambient, glass, and light/dark settings, a non-default brand palette is
saved in the document and travels with it.

### Keyboard and focus behavior

All principal toolbar actions have accessible names. Dialogs, panels, menus,
and popovers:

- move focus into the opened surface;
- cycle focus with Tab and Shift+Tab;
- close the topmost surface with Escape;
- restore focus to the opener.

The context menu supports arrow-key navigation and Enter. Canvas shortcuts do
not fire while typing in fields or while an overlay has focus.

The only repository-configured automated browser project is Desktop Chrome.
Validate keyboard, screen-reader, contrast, and device requirements in the
actual deployment environment before declaring a broader accessibility or
browser-support commitment.

## 14. Agent Workspace collaboration

Agent Workspace is the canonical, revisioned collaboration mode. It is
different from a browser-local draft, a private MCP draft, and a public share
snapshot. See the [workspace design](proposals/0002-shared-human-agent-workspace.md)
for the underlying operation and conflict model.

### Hand off or open a workspace

1. Sign in to the hosted browser editor.
2. Open **Agent Workspace** from the toolbar.
3. To promote the open browser document, choose
   **Hand off current document**.
4. To open an existing workspace, choose **open** beside it. The list shows up
   to 20 recent choices.

The default policy is **Suggest only**. Handoff creates the canonical server
document and connects browser edits to it. It does not publish the document.

A legacy hosted MCP draft appears as **legacy · migrates on open**. Migration is
an explicit browser-owner action. Agent workspace calls do not silently migrate
a legacy ID; they reject it with guidance. After migration, the retained legacy
snapshot is rollback material, and stale legacy mutations are refused.

### Understand the workspace card

The active panel shows:

- workspace ID and a **copy** action;
- current revision;
- **Suggest only** policy;
- status, errors, offline state, and pending operation count;
- **Sync now**, **Reload server**, and **Close workspace**;
- live presence, when available;
- lease control;
- proposals;
- checkpoints;
- timeline.

The toolbar chip changes to call attention to a conflict, proposal count, or
offline pending work. Opening it prioritizes the state that needs attention.

### Review agent proposals

Each proposal includes a title, rationale when supplied, base revision,
operation count, and operation descriptions.

1. Choose **Preview** to render before/after views of affected pages. Added,
   removed, and modified nodes, links, anchors, zones, flow paths, markers, and
   page geometry are represented.
2. Choose an operation description to locate and highlight that change in the
   preview.
3. Leave the desired operation checkboxes selected.
4. Choose:
   - **Accept all** to commit the whole proposal;
   - **Accept selected** to commit a coherent subset;
   - **Reject** to decline it.

Selective acceptance can fail if the chosen operations are not coherent—for
example, if one operation depends on an unselected creation. Review the error,
select the dependent operations together, or accept/reject the full proposal.

Proposal acceptance creates a new forward revision. It does not rewrite past
history.

### Grant direct-write authority

Without a lease, agent changes must be proposals.

Choose **Grant current page · 10 min** only when the agent should write directly
to the page currently open in the browser. The lease:

- lasts ten minutes;
- applies only to that page;
- is an authority grant, not a document-wide lock;
- can be ended immediately with **Revoke now**.

The agent should use **apply_workspace_changes** only while the matching lease
is visibly active. Other pages and expired leases remain proposal-only.

### Checkpoints

The workspace supports up to 12 named checkpoints.

1. Enter a name in **Name this checkpoint…**.
2. Choose **Save**.
3. For an existing checkpoint:
   - **Restore** applies it as a new forward revision after syncing local edits;
   - **Fork** creates a new workspace from it;
   - **Delete** permanently removes that checkpoint.

Restore does not erase the existing history. Deleting a checkpoint cannot be
undone. Agents can create and list checkpoints, but Restore, Fork, and Delete
are browser-owner actions.

### Timeline and presence

**Timeline** lists recent revisions newest-first with revision number, actor,
source, operation summary, accepted-proposal marker, and checkpoint marker.
Older detailed revisions can be compacted; the panel reports the history floor
when that happens.

**Present** shows connected browser editor sessions and, when reported, the page
each is viewing. MCP agents do not currently open a presence socket. Presence
is ephemeral and disappears when the connection is absent; it is not an audit
record.

### Offline editing and recovery

The browser caches the last confirmed workspace baseline and any
unacknowledged operation batch in IndexedDB. While offline:

- the chip can show **agent · offline · N pending**;
- edits remain in the local document;
- pending operations retry after reconnection;
- replay is idempotent and either rebases safely or reports a conflict.

Do not clear browser site data or replace the document while work is pending.
Download JSON as an additional backup.

If recovery finds local edits newer than the last confirmed server sync,
workspace synchronization pauses:

- **Sync local copy** treats the current browser document as the intended work
  and attempts a fresh semantic sync;
- **Reload server** discards unsynced browser edits after confirmation and loads
  the canonical workspace;
- **download** the browser JSON before reloading if the local version might be
  needed.

Ordinary disjoint changes can rebase automatically. Same-field edits and
delete/edit overlap become explicit conflicts; the system does not silently
choose a winner.

## 15. Authoring Preferences and Admin dashboard

### Authoring Preferences

When profiles are enabled, the **prefs** toolbar chip opens
**Authoring Preferences**. It contains patterns observed from corrections to
agent-authored diagrams.

Candidates do not change agent behavior on their own. The panel begins to ask
for confirmation after a repeated pattern has sufficient independent evidence.
Only rules the owner confirms are supplied to agents.

For each rule, review its directive, rationale, status, scope, supporting and
contradicting evidence counts, review warning, and staleness.

Available actions include:

- **Make this a preference…** or **Re-confirm…**;
- scope to **All my diagrams**, an offered diagram archetype, or an offered
  workspace;
- **Don’t learn this**;
- **Pause** or **Resume**;
- **Forget**.

A rejected pattern remains rejected so it is not immediately relearned;
**Forget** clears that record. A paused preference is retained but not applied.
Agents can retrieve and explain confirmed guidance, but cannot confirm,
broaden, restore, or delete owner preferences.

See the [adaptive profile design](proposals/0003-adaptive-agent-authoring-profiles.md)
for the evidence and authority model.

### Admin dashboard

The **admin** chip appears only to the configured deployment owner when
analytics is enabled. The server independently enforces the permission.

The dashboard shows:

- total recorded users and logins;
- GitHub login/name and stable numeric ID;
- first-seen and last-login time;
- login count;
- expandable workspace metadata: title, page count, revision, or legacy state.

It does not expose nodes, links, annotations, document JSON, or rendered diagram
contents. Analytics are best-effort and do not block sign-in. There is no
historical backfill when the feature is first enabled.

If the dashboard says it is disabled or unauthorized, editing and workspaces
continue normally; contact the deployment owner rather than attempting to
change document permissions.

## 16. MCP and agent workflows

The complete tool table and connection details are in the
[MCP guide](../src/mcp/README.md).

### Golden workflow for a private draft

1. Call **describe_capabilities**. Start with its compact index, then request
   full fields only for relevant types or a search query.
2. If authoring profiles are enabled, call **get_authoring_guidance** with the
   task archetype and relevant workspace ID.
3. Call **layout_guidelines** before placing a large diagram.
4. Use **create_topology**, **create_from_template**, or **import_topology**.
5. Prefer one atomic **edit_topology** batch over many one-element calls. A
   private-draft batch accepts at most 200 ordered operations.
6. Call **validate_topology**.
7. Fix semantic errors and use **tidy_topology** or **balance_topology** for
   visual findings. Use **layout_topology** only when rebuilding the
   arrangement is appropriate.
8. Call **inspect_render** for a compact final visual-quality report covering
   crop, labels, link routing, and density.
9. Call **render_svg** once the inspection is clean. Use
   **export_flipbook** for all pages or hosted **share_topology** for a public
   snapshot.
10. Retrieve or export JSON before ending a local stdio process.

Element creation tools default to the most recently added page unless the agent
passes a page index. **render_svg** and **inspect_render** default to page zero.
Agents should target pages explicitly in multi-page work.

### Golden workflow for a shared workspace

For an existing browser-owned document, the owner should first hand it off or
open/migrate it in **Agent Workspace**. An agent can also use
**create_workspace** for a new canonical document.

Then:

1. Use **list_workspaces** to choose a workspace.
2. Call **get_workspace_manifest** and retain the revision, page IDs/counts,
   proposal count, lease state, and operation-schema revision.
3. Call **describe_workspace_operations** only when that schema revision
   changes.
4. Call **get_workspace_changes** from the last observed revision rather than
   repeatedly loading the full document.
5. Hydrate only relevant pages/elements with
   **get_workspace_elements**.
6. Retrieve applicable **get_authoring_guidance** when available.
7. Submit a named, explained **propose_workspace_changes** batch for owner
   review.
8. Use **apply_workspace_changes** only inside a visible, current-page lease.
9. Optionally call **create_checkpoint** before a major change; restore and fork
   remain owner actions.
10. Remember the returned revision and continue with bounded deltas.

Workspace limits include:

- at most 250 operations or 524,288 serialized bytes in an operation batch;
- at most 50 change records per bounded read;
- at most 100 elements per targeted element page;
- at most about 1.8 MiB for any single page and about 1.8 MiB for document
  metadata outside the pages;
- at most 20 unresolved proposals and 50 retained proposals; when room is
  needed, the oldest resolved proposals are pruned first;
- the most recent 500 workspace change records remain available before older
  detailed history is compacted;
- page-scoped direct-write leases;
- explicit conflict responses for incoherent or overlapping work.

### Tool groups

| Task                         | Principal tools                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discover                     | **describe_capabilities**, **layout_guidelines**, **list_templates**                                                                                                                                                                                                     |
| Create/manage private drafts | **create_topology**, **list_topologies**, **get_topology**, **delete_topology**, **create_from_template**, **import_topology**                                                                                                                                           |
| Document/page settings       | **set_document_title**, **add_page**, **set_page_properties**, **set_legend**, **set_palette**                                                                                                                                                                           |
| Add content                  | **add_node**, **set_node_metadata**, **add_link**, **add_anchor**, **add_zone**, **add_flow_path**, **add_policy_marker**                                                                                                                                                |
| Edit content                 | **edit_topology**, **update_element**, **remove_element**, **upsert_by_source**, **define_layer**, **define_node_type**                                                                                                                                                  |
| Check and arrange            | **validate_topology**, **tidy_topology**, **balance_topology**, **layout_topology**, **inspect_render**                                                                                                                                                                  |
| Output                       | **render_svg**, **export_flipbook**, hosted **share_topology** / **list_shares** / **revoke_share**                                                                                                                                                                      |
| Workspace                    | **create_workspace**, **list_workspaces**, **get_workspace_manifest**, **describe_workspace_operations**, **get_workspace_changes**, **get_workspace_elements**, **propose_workspace_changes**, **apply_workspace_changes**, **create_checkpoint**, **list_checkpoints** |
| Preferences                  | **get_authoring_guidance**, **list_authoring_preferences**, **explain_authoring_preference**                                                                                                                                                                             |

### Conditional EdgeConnect live-data tools

Live fabric tools appear only when a TopologyProvider is configured. Their
absence is normal and does not mean the core MCP server is unhealthy.

Available conditional tools are:

- **describe_data_source**;
- **list_appliances** and **list_tunnels**;
- **get_overlay_policies**;
- **list_flows** and **get_flow_details**;
- **build_flow_topology**.

For local demo/development with no fabric access:

    TOPOLOGY_PROVIDER=mock npm run mcp

For EdgeConnect, the process or hosted deployment must supply:

    ORCH_BASE_URL
    ORCH_API_KEY

The API key is an environment secret, never a tool argument. The provider talks
to EdgeConnect Orchestrator rather than directly to appliances. A fabric-wide
query can skip an individually unreachable appliance; a request explicitly
targeting that appliance reports the error.

**build_flow_topology** creates a fresh document from the selected fabric and
flows, including layers, zones, tunnels, animated paths, and markers, then
layouts, tidies, and validates it. Review the resulting Problems and
**inspect_render** report like any agent-authored diagram.

The checked-in deployment configuration does not prove that an Orchestrator is
currently connected. Confirm activation and the supported Orchestrator release
with the deployment operator before promising live-data availability.

## 17. Troubleshooting and recovery

### The save indicator says “⚠ not saved — download JSON”

Browser storage is unavailable or full. Click the warning immediately to
download JSON. Free storage or change the browser policy, then make another edit
and verify **✓ saved**. Do not trust a refresh until a backup exists.

### A public link says the topology was not found

The ID can be incorrect, the snapshot can have expired after 30 days, or the
stored value can be unavailable. Ask the publisher to publish a new snapshot.
There is no recovery from the public URL alone after expiry.

### Opening a shared link seems to replace my canvas

The canvas changes, but the banner indicates that the shared copy is in a
separate autosave slot. Choose **back to my document** to return. Choose
**download** before **keep this copy** if both versions are needed.

### The editor reports an invalid JSON file

Confirm the file is a Topology Dojo document or recognized legacy Topology
Studio save. Do not rename arbitrary JSON to make it importable. If a native
document loads with issues, open Problems and repair reported identifiers,
references, values, or geometry before exporting it again.

### A converted legacy file has warnings

This is expected for unsupported legacy presentation concepts. Keep the
original file, download the converted Topology Dojo JSON separately, and
visually review every page, annotation, label, link route, and export.

### Nodes overlap or content is off-page

Open Problems, then try **tidy**. Use **balance** for a regular row/column finish
or an **arrange…** algorithm when the whole layout can be rebuilt. Finish with
**fit to content**, inspect important manual routes, and check Problems again.

### PNG export fails

PNG rasterization is browser-only. Try **svg** as a lossless fallback, verify
the current page renders, and use a supported local SVG-to-PNG workflow if the
browser still cannot create the raster.

### Agent Workspace is missing or disabled

Workspace controls require the hosted Worker, a signed-in account, and a
deployment where workspaces are enabled. Local Vite editing still autosaves,
but it cannot emulate the hosted workspace service by itself.

### Agent Workspace shows a conflict

Open the chip and read the error before choosing a side. Download JSON first if
there is any doubt. Use **Sync local copy** to preserve and reapply browser work,
or **Reload server** to discard unsynced browser edits and adopt the canonical
version. Same-field and delete/edit conflicts require an explicit decision.

### The browser is offline with pending changes

Keep the tab/profile data intact. The pending batch is cached and retries after
reconnection. If the pending count does not clear, open Agent Workspace and
choose **Sync now**. Download JSON before clearing site data or switching
devices.

### A proposal cannot be partially accepted

The selected subset is likely incoherent. Select all mutually dependent
operations, choose **Accept all**, or reject the proposal and ask the agent for
smaller independent proposals.

### A workspace tool rejects a legacy topology ID

This is intentional. Open the private draft in the browser's Agent Workspace
list and approve migration there, or create a new canonical workspace. Agent
tools do not perform owner migration implicitly.

### Preferences or admin are unavailable

Those features are independently gated. Their absence does not affect ordinary
editing. Ask the deployment owner whether profiles or analytics are enabled and
whether the signed-in identity has the required role.

### Live-data tools are missing

Confirm **TOPOLOGY_PROVIDER=mock** for a local fixture or both Orchestrator
environment values for EdgeConnect. If either required value is absent, the
live tools are deliberately not registered.

### Authentication loops or fails

For the hosted editor, sign out and retry **Sign in with GitHub**. For MCP,
remove the stale client authorization and reconnect so OAuth discovery runs
again. Deployment operators should verify the GitHub OAuth callback, secrets,
KV bindings, and authenticated readiness checks using the
[deployment runbook](DEPLOYMENT_RUNBOOK.md).

## 18. Current limitations and privacy notes

- **Public means public.** A share snapshot needs no authentication and can
  contain the full topology, metadata, addresses, zones, and policy details.
- **Share revocation is bounded, not instant.** A revoked link stops being
  served immediately, but edge/browser caches can keep a copy for up to about
  five minutes. Links published before revocation shipped cannot be listed or
  revoked.
- **Share is a snapshot.** It is not live collaboration. Publish a new snapshot
  after changes.
- **PNG is browser-only.** MCP renders SVG and flipbook HTML, not PNG.
- **Local browser autosave is not cloud backup.** It is tied to the browser
  profile/device until the document is handed off, downloaded, or otherwise
  exported.
- **Local MCP drafts are temporary.** Preserve JSON before ending the stdio
  process.
- **Workspaces are owner-scoped.** The current model does not provide
  organization ACLs, multiple co-owners, or CRDT-style multi-master merging.
- **Leases are narrow.** They last ten minutes and apply only to the current
  page.
- **History is bounded.** Recent workspace revisions can compact, and a
  workspace holds at most 12 named checkpoints.
- **Preferences are advisory and gated.** They are learned only from repeated
  corrections, only confirmed rules reach agents, and they do not guarantee a
  particular agent result.
- **Admin analytics are metadata-only but still identity data.** When enabled,
  the deployment stores GitHub identity and login/workspace metadata. The
  administrator cannot inspect diagram contents through the dashboard.
- **Legacy import can lose concepts.** Keep the source and review conversion
  warnings.
- **Live EdgeConnect support is conditional.** Tool registration and real
  release compatibility must be verified per deployment.
- **Browser/device support is not broadly declared.** Automated browser
  coverage is currently Desktop Chrome. Do not assume full mobile/touch or
  cross-browser support without deployment-specific testing.
- **The retired beat/choreography core is not active.** Current storytelling is
  page-based flipbook playback.

For operational privacy, incident response, and recovery behavior, use the
[deployment runbook](DEPLOYMENT_RUNBOOK.md) and [rollback guide](ROLLBACK.md).

## 19. Related documentation

- [README](../README.md) — product model, entry points, and repository map.
- [MCP guide](../src/mcp/README.md) — remote/local setup and complete tool
  reference.
- [Design](DESIGN.md) — product principles.
- [Architecture](ARCHITECTURE.md) — document, renderer, Worker, and workspace
  architecture.
- [Roadmap](ROADMAP.md) — shipped and planned work.
- [Capability matrix](CAPABILITY_MATRIX.md) — implementation status by surface.
- [QA test plan](launch-readiness/QA_TEST_PLAN.md) — living functional,
  non-functional, and release-gate coverage.
- [UAT plan](launch-readiness/UAT_PLAN.md) — persona-based acceptance journeys.
- [Traceability matrix](launch-readiness/TRACEABILITY_MATRIX.md) — capability,
  guide, QA, UAT, and release-evidence mapping.
- [Shared workspace proposal](proposals/0002-shared-human-agent-workspace.md) —
  revision, operation, proposal, lease, conflict, and migration contracts.
- [Adaptive preferences proposal](proposals/0003-adaptive-agent-authoring-profiles.md)
  — preference evidence, confirmation, scope, and agent guidance.
- [Deployment runbook](DEPLOYMENT_RUNBOOK.md) — staged deployment and service
  verification.
- [Rollback guide](ROLLBACK.md) — rollback and forward-recovery procedures.
