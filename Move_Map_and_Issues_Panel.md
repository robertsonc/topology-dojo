You are working on Topology Dojo, a web-based network topology editor with a dark theme. The editor has: a top toolbar, a collapsible node palette on the left, a canvas in the center, a collapsible properties panel on the right, a frame strip and status bar at the bottom, a floating minimap in the bottom-right corner, and a floating "⚠ warnings" chip in the bottom-left corner. Explore the codebase first to find where these components live before making changes.

Complete these three tasks in order, as separate commits.

TASK 1 — Fix: canvas node icons render as solid black when the node palette is collapsed.

When the palette is expanded, node icons on the canvas render correctly with their fills, gradients, and glow effects. When the palette is collapsed, the same icons render as solid black shapes. Diagnose the root cause before changing anything. The most likely cause: shared SVG resources (icon symbols, defs, gradients, filters) are defined inside the palette's DOM, and canvas nodes reference them by id; collapsing the palette unmounts that DOM or hides it with display:none, which breaks the references — a missing paint server renders black. Confirm by inspecting the rendered DOM in both palette states and locating where the referenced ids actually live.

Once confirmed, fix it structurally:
- Move all shared SVG defs (symbols, gradients, filters, markers) into a single sprite/defs SVG mounted once at the app root, outside any collapsible or conditionally-rendered container.
- Hide that sprite with width="0" height="0" position:absolute and aria-hidden="true". Do not use display:none — it also breaks reference resolution in several browsers.
- Ensure the palette collapse no longer unmounts or hides anything referenced by id elsewhere.
- Verify: toggle the palette repeatedly, reload the app with the palette collapsed (if state persists), and confirm icons render correctly. Also verify SVG/PNG export still includes all needed defs with the palette collapsed.

TASK 2 — Move the minimap from its floating bottom-right position into the bottom of the left rail.

- Restructure the left side into a fixed-width, full-height rail: palette header and search at the top, scrollable node list filling the middle, and the minimap docked as a fixed-height (~160px) section at the bottom, separated by a border.
- The minimap section gets its own collapse chevron; collapsed state shows only its header row.
- When the whole left rail is collapsed, the minimap collapses with it — never leave it floating alone.
- The minimap's position must not shift when palette content changes or the list is filtered — it is docked, not positioned relative to list height.
- Remove the old floating minimap and its "map" toggle chip from the canvas corner.
- Persist both collapse states using the same mechanism as existing panel state.

TASK 3 — Move warnings from the floating bottom-left chip into a pinned "Problems" section on the right rail.

- Add a "Problems" section pinned to the bottom of the right properties rail: the existing property sections scroll above it; Problems stays fixed at the bottom.
- Header shows "Problems", a count badge, and a collapse chevron. Default collapsed when the count is 0.
- Each warning row shows severity, message, and the referenced node/page. Clicking a row selects that node and pans/zooms the canvas to it, switching pages first if the warning references another page. Reuse existing selection and viewport-centering logic if available.
- Add a persistent warning count (e.g. "⚠ 3") to the bottom status bar, visible regardless of panel state. Clicking it opens the right rail if hidden and expands the Problems section.
- Remove the old floating bottom-left warnings chip. The warnings data source is unchanged — this is presentation only.

CONSTRAINTS
- No new dependencies.
- Use the existing theme tokens, CSS variables, and panel/border/collapse styling so new sections look native.
- Canvas pan/zoom/selection behavior is unchanged except the new click-to-navigate.
- Apply the existing slim hover-reveal scrollbar treatment to any scrollable containers you create or modify.

ACCEPTANCE
- Icons render correctly with the palette collapsed, including after reload and in exports.
- Minimap is docked bottom-left in the rail, stable, collapsible, and gone when the rail is collapsed; nothing floats bottom-right.
- Problems section is pinned bottom-right with a working count badge and click-to-navigate; status bar count always visible and opens the section.
- No floating chrome remains in the canvas corners.
- All panel collapse states persist across reload.
