# Fix: light-theme renders look muted / washed out vs draw.io

Status: **planned** — scheduled after hw-catalog Phase 4 (PR #288) merges,
before hw-catalog Phase 5. Its own branch and PR, small commits, no Worker
deploy. The brief below is kept as received; re-check the line numbers
before editing (they were verified at commit 7e951f3).

Related: the "Clean render profile" roadmap item also edits
`flattenViewer`; whichever lands second rebases onto the other.

## Problem

Topology Dojo light-theme output (`render_svg` / `export_topology` with
`theme: "light"`) looks pale next to draw.io. Root cause: the vendored engine
(`public/vendor/topology-ds.js`) is tuned for neon-on-dark. Lines and labels
are drawn with low opacity and depend on bloom/glow filters for luminance.
Two later passes in `render/core` each made sense alone but compound:

- `flattenViewer` (`src/vendor/topology-ds.ts` ~L447) strips every `tds-*`
  filter, removing the glow.
- `applyRenderTheme` (`src/render/theme.ts`) flips the canvas light.

Result: translucent thin lines on a grey page.

Verified at commit 7e951f3 (re-check line numbers before editing):

- `_renderFlow` (~L3860): 8px glow stroke @ .03, main 1.8px stroke @ .4,
  0.8px dashed overlay @ .2
- `_renderLine` / `_renderLinePath` (~L3746-3766): opacity = 0.7 \* op
- other wire renderers (~L3836 `_renderWG`, ~L3985, ~L3926, ~L4030): main
  strokes .35-.5, glow underlays 6-12px @ .03-.04
- `_renderZoneRect` (~L4231): fill-opacity .04, stroke-opacity .35, title
  opacity .7, sublabel .5
- `LIGHT_BACKGROUND = '#f0f1f3'`; card border `#3e4550` remaps to `#ccd4dc`
  (low contrast on grey)

Measured composited contrast on `#f0f1f3`:

| element                      | solid | as rendered |
| ---------------------------- | ----- | ----------- |
| flow link `#1a9e5c` @ .4     | 3.1:1 | 1.5:1       |
| straight link `#2563eb` @ .7 | 4.6:1 | 2.8:1       |
| red link `#dc2626` @ .5      | 4.3:1 | 2.2:1       |
| zone stroke `#5c6b76` @ .35  | 4.9:1 | 1.6:1       |
| zone label `#5c6b76` @ .7    | 4.9:1 | 2.8:1       |

Why nothing caught it: `src/render/theme.test.ts` checks `LIGHT_THEME_MAP`
target colours as SOLID hex. It never composites the opacity they're drawn
at.

Also: `flattenViewer` removes the filter attribute but leaves the wide
glow-underlay strokes, so each link gets an unblurred translucent band
(haze).

## Constraint: no blanket alpha floor

A prototyped regex pass that forced opacity up everywhere recovered links,
but cloud nodes and fill washes became opaque blobs hiding their labels. The
engine uses opacity both for fill washes (keep) and for primary
strokes/text (fix). The fix must be role-aware, at the source.

## Changes

1. **Engine theme knobs** (`public/vendor/topology-ds.js`). Add
   renderer-level alphas, e.g. `this.lineAlpha` and `this.textAlpha`. Dark
   keeps today's exact values; light sets 1. Apply to the PRIMARY stroke in
   `_renderFlow`, `_renderLine`, `_renderLinePath`, `_renderWG` and the other
   wire-type renderers, plus zone stroke-opacity and zone title/sublabel
   opacity. Do NOT touch fill washes (cloud fills, zone fill-opacity, badge
   discs). Wire the theme from `render/core` (`renderPageWithEngine`) and the
   browser path (`renderPageSVG`) so the canvas, headless MCP, flipbook and
   exports stay identical.
2. **Drop glow underlays in `flattenViewer`.** Remove the unfiltered glow
   strokes entirely (the 4-12px strokes at opacity <= .05 that carried a
   `tds-glow*` / bloom filter). Matching on "had a tds filter AND opacity <=
   .05" before stripping filters is safer than matching width. In light
   theme, also drop the secondary 0.8px dashed detail overlay on
   flows/wires.
3. **Light export background:** white (`#ffffff`) for exports (`render_svg`,
   `export_topology`, flipbook, PDF/PNG). Keeping `#f0f1f3` for the live
   editor canvas is fine if separable. Update `themeBackground` and the
   tests that pin it.
4. **Light minimums:** primary link stroke >= 1.5px in light; card border
   remap `#3e4550` -> ~`#9aa5b1` (verify >= 3:1 against the white card and
   the page).
5. **Test that composites (the important one).** A render-level test:
   render a probe page covering every node type, every link/wire type,
   flows, zones, callouts, legend and caption with theme `light`. Parse each
   stroke/text element, multiply nested opacities (element opacity,
   group opacity/style opacity, stroke-opacity/fill-opacity), alpha-blend
   over the actual background, and assert:
   - primary link/flow strokes >= 3:1
   - text >= 4.5:1 (zone labels, node labels, wire labels)

   Exempt elements explicitly tagged as decorative/fill-wash. Prefer a data
   attribute or class added in the engine over guessing from values. The
   test should fail on current main before the fix.

## Acceptance

- Dark-theme SVG output for existing fixtures is unchanged except for the
  removed glow-underlay strokes. Snapshot-diff `fixtures/*.json` before and
  after; any other dark diff is a bug.
- Light renders of `fixtures/venue-distribution-leaf.json` and
  `fixtures/EdgeHA_after.json`: links read as solid colour lines, clouds stay
  translucent with readable labels, zone borders and labels are clearly
  visible. Rasterize before/after with Playwright and include the PNGs in
  the PR.
- New composited-contrast test passes; existing `theme.test.ts`, inspect and
  link-attach tests pass; `npm run lint` and typecheck clean.
- Update the MCP README / `describe_capabilities` only if a user-visible
  option changes.

## Out of scope (note in the PR, don't do)

Text is 7-9px in ~2000-unit viewBoxes, which lands around 3-4pt when fit to
a PDF page. That's a separate scaling decision (font floor vs export scale);
leave it for a follow-up issue.

## Notes for whoever picks this up

- hw-catalog Phase 4 added wire-sheet overlay colours
  (`src/render/wiresheet.ts`: pills, headers, badges, notes) that go through
  the same light remap; include a wire-sheet page in the composited probe so
  they are held to the same bar.
