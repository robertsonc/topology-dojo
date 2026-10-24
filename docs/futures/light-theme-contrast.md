# Fix: light-theme renders look muted / washed out vs draw.io

Status: **done**, in review — the plan below is kept as received. What
landed, and what differed from the plan, is under "Outcome" at the end.

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

## Outcome

- **Test first.** `src/render/light-contrast.test.ts` renders the probe
  (`src/testing/light-probe.ts`: every node type, every link type, the
  engine accents, zones, a flow path, legend, caption) and the hw-catalog
  wire sheet in light, and composites every stroke and text paint over its
  real backdrop (`src/testing/contrast.ts`: nested opacity, chip /
  panel backdrops under text). It failed on main (no primary strokes; 26
  probe labels and 78 wire-sheet labels under 4.5:1) and passes now.
- **Engine knobs** as planned (`lineAlpha`, `textAlpha`, plus
  `minLineWidth` and `detailOverlays`), applied to the primary stroke of
  every wire renderer and of page-level flow paths, and to zone stroke and
  labels. Primary strokes are tagged `data-tds-role="primary"`, icon art text
  `wash`; the tags are stripped from dark output.
- **Glow underlays** dropped in `flattenViewer` on "tds filter AND opacity ≤
  .05". Dark output for every fixture page and the probe differs from main
  only by those removed elements (element diff); the link-attach byte pins
  were re-pinned on that evidence.
- **White light exports** via `LIGHT_EXPORT_BACKGROUND`; the editor canvas
  keeps `#f0f1f3`. The flipbook player chrome around the frames is unchanged.
- **Deviations.** The suggested card border `#9aa5b1` is 2.5:1 on white, below
  the 3:1 the plan asks for; it is `#7f8d9c` (3.39:1 on white, 3.0:1 on the
  canvas), under a new `border` role. Four light accents were also darkened
  so a wire label in the link colour reaches 4.5:1 (`#037b5a`, `#8b6800`,
  `#956309`, `#a15d0c`); the plan did not list them, the test found them.
  Vendor icon badges (white on AWS orange / Azure blue, ~2:1 in both themes)
  are tagged `wash`: they predate this and are not a light-theme issue.
- **Before / after** (Playwright, light, calm):
  [`venue-distribution-leaf` before](light-theme-contrast/venue-distribution-leaf.light.before.png)
  · [after](light-theme-contrast/venue-distribution-leaf.light.after.png) ·
  [`EdgeHA_after` before](light-theme-contrast/EdgeHA_after.light.before.png)
  · [after](light-theme-contrast/EdgeHA_after.light.after.png).
- **Still out of scope:** text is 7-9px in ~2000-unit viewBoxes (3-4pt on a
  fitted PDF page) — a font-floor vs export-scale decision for a follow-up.
