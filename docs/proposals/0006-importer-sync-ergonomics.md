# Proposal 0006 — Importer sync ergonomics: `element.upsert`, sourced-element listings, upsert outcomes

**Status:** Implemented. No flag: every change is additive to the MCP tool
surface and the coordinator's input vocabulary; the stored workspace operation
vocabulary is unchanged, so no Durable Object migration and no browser change.

**Captured:** 2026-09-20

**Addresses:** the remaining two "fix at the source" findings from the NetClaw
integration review (`robertsonc/netclaw` spec 124, review round 1), and the
roadmap's "Source-drift reconciliation" item's first prerequisite. Companion
to proposal 0005 (API keys), which covers how such an importer authenticates.

## Context

`upsert_by_source` already makes private-draft imports idempotent: an element
keyed by `(system, kind, id)` is patched if present and created otherwise.
Three gaps made a re-syncing importer (NetClaw pulling NetBox, CML, pyATS,
IP Fabric, …) do more work than the coordinator could do for it:

1. **Shared workspaces had no source-keyed write.** The operation vocabulary
   (`document.patch`, `page.*`, `element.add/patch/remove/reorder`) names
   elements by id only. An importer proposing changes to a colleague's
   workspace had to hydrate the page, resolve ids by `source` itself, and emit
   `element.add`/`element.patch` — moving the idempotency guarantee out of the
   coordinator and into every client.
2. **No cheap way to list what a document already imported.**
   `get_topology(summary: true)` returns counts only; an absent-at-source diff
   needed whole pages via `get_topology(pageIndex)` or paginated
   `get_workspace_elements`.
3. **`edit_topology` dropped the `created` flag** that `upsert_by_source`
   computes, so a batch could not report created vs. patched counts.

## Goals

1. Give shared workspaces the same idempotent, source-keyed write private
   drafts have, without a tenth stored operation type.
2. Make "what is sourced here?" a single bounded call for drafts and
   workspaces.
3. Let a batch report upsert outcomes.
4. Change nothing for the browser: proposal previews, selective acceptance,
   conflict targets, and the revision log keep their exact vocabulary.

## Non-goals

- Cross-page or cross-document source matching (matching stays per page, as
  in `upsert_by_source`).
- A source-drift review UI ("this element's source data changed since last
  import") — that is the roadmap item this proposal only enables.
- Changing how proposals conflict or are accepted.

## Design

### `element.upsert` is an input, normalized at the coordinator

```
{ type: "element.upsert", pageId, kind, source: { system, kind, id, fetchedAt? },
  element?: { …fields }, afterElementId?: string | null }
```

`src/workspace/upsert.ts` (pure) resolves each upsert against a working copy
of the document, advanced operation by operation, so a later upsert sees what
an earlier op in the same batch created:

- a `kind` element on `pageId` carrying the same `(system, kind, id)` exists →
  `element.patch` on that id with `patch.set = { …fields, source }` (`id` in
  `element` is ignored; `fetchedAt` is refreshed, never matched);
- otherwise → `element.add` with `{ …fields, id, source }`; `id` is the
  requested one (rejected if it already exists on the page without this
  source) or a minted `<kind>-<8 hex>`; the kind's create-required fields
  (node `type/x/y`, link `type/from/to`, flowPath `waypoints`, policyMarker
  `nodeId/type`) must be present — same table as `upsert_by_source`;
- `anchors` cannot carry a source and are rejected.

`worker/document.ts` runs this in `propose()` and in the commit path (leased
agent applies and browser commits alike) **before** validation, conflict
detection, summary, and storage, mutating the request's operations in place.
Every downstream consumer — `conflictingTargets`, `summarizeOperations`, the
stored `WorkspaceChange`/`WorkspaceProposal`, selective acceptance, the
profile learner, the browser's proposal preview — sees only the nine stored
types. `operationSchemaRevision` becomes **2** so agents know to re-read
`describe_workspace_operations`, which now documents `element.upsert` and
carries an `upsertExample`.

Because normalization happens against the document at submission time, a
proposal stores concrete `element.add`/`element.patch` operations. That alone
would not keep the "never duplicates" contract for a *delayed* proposal: if
someone else binds the same source between propose and accept, the stored
`element.add` carries a different element id, so element-id targets do not
overlap. `operationTargets` therefore also emits a **source-identity target**
(`page/<pageId>/source/<kind>/<system>/<kind>/<id>`, components URI-encoded)
for every `element.add` whose element carries a `source` and every
`element.patch` that sets one. Acceptance then reports `conflict` on that
target instead of adding a second element; the agent re-reads
`get_workspace_changes`, re-diffs, and proposes again (the upsert now resolves
to a patch). A leased apply is unaffected: it converges immediately against
the current document. The advertised 512 KiB batch limit is enforced twice —
on the input and again on the normalized operations, since an upsert expands
into a larger add/patch.

### Sourced-element listings

- `get_topology({ topologyId, sources: true, system?, pageIndex? })` →
  `{ title, pageCount, pages: [{ index, id, name, elements: [{ id, kind, source, label? }] }] }`,
  only elements carrying a `source`, optionally restricted to one
  `source.system`. No geometry, no unsourced elements.
- `get_workspace_elements({ …, sourcedOnly: true })` → the existing paginated
  hydration filtered to elements with a `source`, so a workspace diff pulls
  only what an importer owns.

### Upsert outcomes in batches

`edit_topology` results keep `{ op, id, pageIndex }` and add
`created: true | false` for `upsert_by_source` operations, taken from the
handler's own `UpsertResult`. Proposals and revisions already expose the
same information through `summary.byType` (`element.add` vs `element.patch`
counts) and `detail: "operations"`.

## Acceptance criteria

- [x] `src/workspace/upsert.test.ts`: patch-by-source with id stripping and
      `fetchedAt` refresh; create with requested or minted id; in-batch
      idempotency; visibility of earlier ordinary ops; pass-through; the
      rejection set (anchors, bad source, unknown page, missing create fields,
      id collision).
- [x] `src/workspace/document-do.test.ts`: propose → `element.add` ×2 with
      requested/minted ids → accept → leased apply of the same sources →
      `element.patch` + one `element.add` in the stored change; snapshot
      converges; create without required fields rejected before storage.
- [x] `src/mcp/tools.test.ts`: `describe_workspace_operations` revision 2 with
      `element.upsert`; `get_topology sources:true` (filtering, `system`,
      out-of-range page); `edit_topology` `created` flag; `sourcedOnly`
      forwarded to the service.
- [x] `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` green.

## Follow-ups

- Source-drift review (roadmap _Next_): surface "changed since last import"
  in the proposal review UI, using the `fetchedAt` the coordinator now
  refreshes on every upsert.
- NetClaw spec 124: workspace path (US4) switches to `element.upsert`;
  the absent-at-source diff switches to `get_topology(sources: true)` /
  `get_workspace_elements(sourcedOnly: true)`.
