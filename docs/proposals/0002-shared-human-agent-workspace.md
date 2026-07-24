# Proposal 0002: Shared human-agent workspace

**Status:** Accepted for Phase 0 implementation (vertical slice)

**Decision date:** 2026-07-12
**Product policy:** Suggest-only by default; UI-controlled scoped leases; lazy migration

## Why this exists

The browser editor and MCP currently share a document format, capability catalog,
and renderer, but they do not edit one canonical workspace. The browser autosaves
one document to `localStorage`; MCP sessions load and rewrite documents in a
per-user registry. That gap creates three unacceptable properties:

1. a human and an agent can unknowingly edit divergent copies;
2. whole-document registry writes can overwrite a concurrent session's changes;
3. keeping an agent informed appears to require repeatedly sending the complete
   document through the model context (a "token furnace").

This proposal makes the server-side workspace canonical while keeping model
context proportional to the change being discussed, not to document size.

## Decisions

### 1. One coordinator per document

Every shared topology is owned by one `TopologyDocument` Durable Object addressed
by the stable owner id and topology id. It serializes commits, owns the current
revision, stores proposals and leases, and is the only writer after handoff.

The existing per-user `TopologyRegistry` becomes a directory and migration
source. It no longer owns mutable shared-document contents.

### 2. Semantic operations are the write protocol

Clients submit compact operations with a `baseRevision` and idempotency key.
The initial vocabulary is deliberately small:

- `document.patch`
- `page.add`, `page.patch`, `page.remove`, `page.reorder`
- `element.add`, `element.patch`, `element.remove`, `element.reorder`

An operation names stable page and element ids. It never names a page by array
index. A browser compatibility adapter may diff its already-local last-synced
snapshot to produce these operations; that diff is local computation and sends
no model tokens. New editor gestures should emit operations directly over time.

### 3. Revisions and bounded change reads

Every accepted operation batch creates one atomic revision and one undoable
change record. An agent remembers only its last-seen revision and asks for:

- a manifest (title, revision, pages and counts);
- bounded change summaries since a revision;
- selected pages/elements when detail is actually needed.

Browser synchronization traffic is ordinary JSON over the workspace API. It is
never automatically inserted into an LLM prompt. The agent wakes only for a
task, an explicit handoff, or an allowed automation.

The operation log is bounded. Old records compact behind a history floor; a
client older than that floor receives `checkpointRequired` and requests only the
needed current page/element snapshot.

### 4. Agents propose by default

Without a lease, an agent cannot directly mutate the canonical document. It
submits a named proposal containing semantic operations, rationale, and the base
revision. The UI shows the affected pages/elements and per-operation summary.
The owner may accept or reject it. Acceptance is one atomic revision and one
undo unit.

### 5. A lease grants authority; it is not a mutex

Only an authenticated browser UI may grant or revoke a lease. The first slice
supports a short, expiring current-page lease. The agent can read the lease but
cannot create, widen, renew, or transfer it.

The UI remains writable while a lease exists. Safe concurrent changes rebase;
overlapping changes conflict. A global human/agent checkout is intentionally not
the normal workflow because it makes quick collaboration cumbersome and turns
abandoned sessions into locks.

### 6. Optimistic conflict handling

Each operation maps to field-level targets. When `baseRevision` is behind, the
coordinator compares those targets with committed operations since that base.

| Concurrent changes                          | Result            |
| ------------------------------------------- | ----------------- |
| Different elements                          | Rebase and commit |
| Same element, different fields              | Rebase and commit |
| Different pages, addressed by page id       | Rebase and commit |
| Same field                                  | Conflict          |
| Delete versus edit of the same page/element | Conflict          |
| Page reorder versus add/remove/reorder      | Conflict          |

Conflicts never silently choose a winner. A proposal remains reviewable and is
marked conflicted; a direct leased commit is rejected with its conflicting
targets and current revision.

### 7. Failure-safe lazy migration

An existing `tdoc:<id>` registry document migrates on first workspace access:

1. parse the legacy snapshot;
2. idempotently initialize its document coordinator in one storage transaction;
3. write a workspace directory marker only after initialization succeeds;
4. retain the legacy snapshot as rollback material during this phase.

Once the marker exists, legacy MCP mutation tools must refuse that topology and
direct the caller to workspace tools. This prevents old sessions from writing a
stale copy after handoff without requiring a dual-write window.

> **Amendment (2026-07):** "first workspace access" now means first _owner_
> access. Because migration is one-way and switches all agent writes to the
> proposal/lease model, agent-facing MCP workspace tools no longer trigger it:
> calling any of them with a legacy topology id is rejected with guidance and
> the draft is left untouched. Lazy migration still happens on the
> owner-authenticated browser routes (and the Agent Workspace panel's explicit
> hand-off), where it is an owner decision.

## Storage layout

The coordinator does not store a complete multi-page document in one Durable
Object key. The 2 MB key/value ceiling would reject realistic QA-scale files.

- `meta` — owner, revision, title, ordered page ids, document-level settings,
  history floor, and active lease;
- `page:<pageId>` — one page snapshot per key;
- `change:<revision>` — compact accepted operation batch and summary;
- `proposal:<proposalId>` — bounded proposal payload and status;
- `request:<operationId>` — short idempotency result.

The first slice caps one operation batch/proposal at 512 KiB, 250 operations,
and one page snapshot at 1.8 MiB. Oversize writes fail visibly before mutation.

## Browser API (owner-authenticated)

| Method   | Route                                       | Purpose                                                        |
| -------- | ------------------------------------------- | -------------------------------------------------------------- |
| `POST`   | `/api/workspaces`                           | Hand the current local document into a workspace               |
| `GET`    | `/api/workspaces/:id`                       | Get canonical snapshot and revision; lazily migrates legacy id |
| `GET`    | `/api/workspaces/:id/manifest`              | Compact status, page counts, lease, proposals                  |
| `POST`   | `/api/workspaces/:id/operations`            | Commit UI operations optimistically                            |
| `GET`    | `/api/workspaces/:id/proposals`             | List pending/recent proposal summaries                         |
| `GET`    | `/api/workspaces/:id/proposals/:pid`        | Get review detail                                              |
| `POST`   | `/api/workspaces/:id/proposals/:pid/accept` | Atomically accept after conflict check                         |
| `POST`   | `/api/workspaces/:id/proposals/:pid/reject` | Reject without document mutation                               |
| `PUT`    | `/api/workspaces/:id/lease`                 | Grant a current-page lease with bounded TTL                    |
| `DELETE` | `/api/workspaces/:id/lease`                 | Revoke immediately                                             |

All mutation responses report durable success or an explicit error. There is no
"log the persistence failure and return success" path.

## MCP workspace tools

The remote MCP surface adds:

- `create_workspace`
- `list_workspaces`
- `get_workspace_manifest`
- `describe_workspace_operations` (on demand; only when its revision changes)
- `get_workspace_changes`
- `get_workspace_elements`
- `propose_workspace_changes`
- `apply_workspace_changes` (requires a valid UI-granted lease)

`get_workspace_changes` defaults to summary detail and is bounded by revision
count. `get_workspace_elements` is the targeted hydration path; agents should
not call the full snapshot endpoint as a routine synchronization mechanism.

## First vertical slice

This phase delivers one GitHub owner collaborating with their agents. It does
not yet deliver organization workspaces, multi-human presence/cursors, comments,
offline multi-master editing, CRDTs, or a complete historical timeline UI.

The editor provides an Agent Workspace panel that can:

- hand off the current document and show its id/revision;
- show that policy is **Suggest only**;
- list and inspect agent proposals;
- accept or reject a proposal;
- grant/revoke a ten-minute lease for the current page;
- surface sync, conflict, migration, and persistence failures.

Proposal review in this slice is semantic (operation and affected-element
detail). A rendered before/after visual diff is the next UI increment.

## Acceptance criteria

1. Two clients committing disjoint element fields from the same base both
   succeed and produce consecutive revisions.
2. Two clients changing the same field from the same base produce an explicit
   conflict; neither change is silently lost.
3. An agent without a lease can create a proposal but cannot directly commit.
4. Only the browser API can grant a lease; a leased agent can change only the
   leased page and only until expiry.
5. A proposal accepted after unrelated UI edits rebases and commits atomically.
6. A proposal overlapping later UI edits becomes conflicted and remains intact
   for review.
7. `get_workspace_changes` returns bounded summaries and targeted element reads
   avoid returning the complete document.
8. A legacy registry document initializes once, retains its source snapshot,
   and rejects subsequent legacy mutation.
9. A simulated persistence failure returns failure to the caller and does not
   advance the revision.
10. A document larger than 2 MB in aggregate succeeds when each page is under
    the per-page limit; an oversize individual page fails visibly.

## Follow-on work

- visual before/after proposal preview and selective acceptance;
- gesture-native operations (remove the browser snapshot-diff adapter);
- IndexedDB offline cache and crash recovery;
- named checkpoints, restore, fork, and a revision timeline;
- WebSocket push/presence (polling compact manifests is acceptable here);
- explicit collaborator ACLs and organization workspaces;
- finer element-set leases and approved automations;
- comments, mentions, and review threads.
- adaptive authoring profiles built from actor-attributed corrections, with
  confirmation, scoping, revisioned guidance, and hard context budgets
  ([Proposal 0003](0003-adaptive-agent-authoring-profiles.md)).
