import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from '../testing/worker-harness.js';
import { MAX_CANDIDATES_PER_OWNER } from '../profile/learner.js';

/**
 * Worker-level harness (Miniflare, CI only — fails to start locally with
 * `File is not defined`, same as `document-do.test.ts`). It binds BOTH the
 * `AuthoringProfile` DO (exercised directly for dedupe/burst/bounds/isolation)
 * and the `TopologyDocument` coordinator (for the observe-only accept → correct
 * → checkpoint end-to-end and the PROFILES_ENABLED gate). The coordinator's
 * emission reaches the profile DO through the same `AUTHORING_PROFILE` binding
 * this harness reads back, so identity resolution matches production.
 */
const harness = String.raw`
import { TopologyDocument } from './worker/document.ts';
import { AuthoringProfile } from './worker/profile.ts';
export { TopologyDocument, AuthoringProfile };
export default {
  async fetch(request, env) {
    try {
      const input = await request.json();
      const owner = String(input.owner ?? '42');
      const workspace = String(input.workspace ?? 'w1');
      const docStub = env.DOC.get(env.DOC.idFromName(owner + ':' + workspace));
      const profStub = env.AUTHORING_PROFILE.get(env.AUTHORING_PROFILE.idFromName(owner));
      const user = { kind: 'user', id: owner };
      const agent = { kind: 'agent', id: owner };
      let result;
      switch (input.action) {
        case 'recordOutcome': await profStub.recordOutcome(owner, input.outcome); result = { ok: true }; break;
        case 'listPreferences': result = await profStub.listPreferences(owner); break;
        case 'getProfile': result = await profStub.getProfile(owner); break;
        // Packet P3 manage actions. 'asOwner' (default: the stub's owner) is the
        // ownerId ASSERTED to the DO, so tests can prove the owner check rejects
        // a mismatched caller against another owner's instance.
        case 'setStatus': result = await profStub.setPreferenceStatus(String(input.asOwner ?? owner), String(input.preferenceId), input.status); break;
        case 'confirm': result = await profStub.confirmPreference(String(input.asOwner ?? owner), String(input.preferenceId), input.scope); break;
        case 'reject': result = await profStub.rejectPreference(String(input.asOwner ?? owner), String(input.preferenceId)); break;
        case 'guidance': result = await profStub.getGuidance(String(input.asOwner ?? owner), input.query ?? {}); break;
        case 'deletePreference': await profStub.deletePreference(String(input.asOwner ?? owner), String(input.preferenceId)); result = { ok: true }; break;
        case 'initialize': result = await docStub.initialize(owner, workspace, input.document); break;
        case 'snapshot': result = await docStub.getSnapshot(owner); break;
        case 'user': result = await docStub.applyUserOperations(owner, user, input.commit); break;
        case 'agent': result = await docStub.applyAgentOperations(owner, agent, input.commit); break;
        case 'propose': result = await docStub.propose(owner, agent, input.commit, String(input.title ?? 'Proposal')); break;
        case 'accept': result = await docStub.acceptProposal(owner, user, String(input.proposalId), String(input.operationId)); break;
        case 'lease': result = await docStub.grantPageLease(owner, user, String(input.pageId), 600); break;
        case 'checkpoint': result = await docStub.createCheckpoint(owner, user, String(input.name)); break;
        default: return Response.json({ error: 'bad action' }, { status: 400 });
      }
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
};
`;

let on: MiniflareHandle; // PROFILES_ENABLED='true'
let off: MiniflareHandle; // PROFILES_ENABLED unset

async function call<T>(
  handle: MiniflareHandle,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await handle.fetch('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

interface StoredPref {
  id: string;
  ownerId: string;
  status: string;
  supportingOutcomes: number;
  evidenceDocuments: number;
  confidence: number;
  scope: { kind: string; workspaceId?: string; archetype?: string };
  trigger: {
    archetype?: string;
    requiredTraits: string[];
    excludedTraits?: string[];
  };
  sourceRevisionRefs: string[];
  confirmedAt?: string;
  contradictingOutcomes?: number;
  exceptionWorkspaceIds?: string[];
  needsReview?: boolean;
}

interface GuidanceBody {
  notModified?: boolean;
  profileRevision: number;
  guidanceRevision: number;
  rules?: { id: string; directive: string; scope: string }[];
  omitted?: { ids: string[]; count: number };
  tokenEstimate?: number;
}

function outcome(over: Record<string, unknown> = {}) {
  return {
    archetype: 'multi-region-hub-spoke',
    addedTraits: ['layered-regional', 'spokes-below-hub'],
    removedTraits: ['radial-placement'],
    scope: { kind: 'user' },
    sourceRevisionRef: 'w1@r5',
    documentRef: 'w1',
    summary: 'radial → layered regional hub/spoke hierarchy',
    ...over,
  };
}

/* ── coordinator fixtures: a hub whose spokes are corrected radial→below ── */

function node(id: string, x: number, y: number) {
  return { id, type: 'ec', x, y, label: id };
}
function addNode(pageId: string, id: string, x: number, y: number) {
  return {
    type: 'element.add',
    pageId,
    kind: 'nodes',
    element: node(id, x, y),
  };
}
function addLink(pageId: string, id: string, from: string, to: string) {
  return {
    type: 'element.add',
    pageId,
    kind: 'links',
    element: { id, type: 'line', from, to },
  };
}
function patchNode(pageId: string, id: string, set: Record<string, unknown>) {
  return {
    type: 'element.patch',
    pageId,
    kind: 'nodes',
    elementId: id,
    patch: { set },
  };
}

const HUB_DOC = {
  title: 'Hub',
  customNodes: [],
  pages: [
    {
      id: 'p1',
      name: 'p1',
      viewBox: '0 0 1050 700',
      nodes: [node('H', 500, 300)],
      links: [],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    },
  ],
};

// Agent authorship: add three spokes ABOVE the hub (radial) plus their links.
const AGENT_RADIAL_OPS = [
  addNode('p1', 'S1', 400, 150),
  addNode('p1', 'S2', 500, 150),
  addNode('p1', 'S3', 600, 150),
  addLink('p1', 'l1', 'H', 'S1'),
  addLink('p1', 'l2', 'H', 'S2'),
  addLink('p1', 'l3', 'H', 'S3'),
];
// User correction: move every spoke BELOW the hub.
const USER_BELOW_OPS = [
  patchNode('p1', 'S1', { y: 450 }),
  patchNode('p1', 'S2', { y: 450 }),
  patchNode('p1', 'S3', { y: 450 }),
];

/** Run the full accept → correct → checkpoint sequence on one handle and return
 * every coordinator response plus the resulting profile. */
async function runObserveSequence(handle: MiniflareHandle, owner: string) {
  const workspace = 'obs';
  await call(handle, {
    action: 'initialize',
    owner,
    workspace,
    document: HUB_DOC,
  });
  const proposed = await call<{ proposal: { id: string } }>(handle, {
    action: 'propose',
    owner,
    workspace,
    title: 'add spokes',
    commit: {
      baseRevision: 0,
      operationId: 'pr1',
      operations: AGENT_RADIAL_OPS,
    },
  });
  const accept = await call<Record<string, unknown>>(handle, {
    action: 'accept',
    owner,
    workspace,
    proposalId: proposed.proposal.id,
    operationId: 'acc1',
  });
  const userCommit = await call<Record<string, unknown>>(handle, {
    action: 'user',
    owner,
    workspace,
    commit: { baseRevision: 1, operationId: 'u1', operations: USER_BELOW_OPS },
  });
  const checkpoint = await call<{ revision: number; pageCount: number }>(
    handle,
    {
      action: 'checkpoint',
      owner,
      workspace,
      name: 'after correction',
    },
  );
  return { accept, userCommit, checkpoint };
}

/** Poll the owner's profile until it has at least `min` candidates (the
 * coordinator emits via `waitUntil`, after the checkpoint response returns). */
async function pollProfile(
  handle: MiniflareHandle,
  owner: string,
  min: number,
  tries = 40,
): Promise<StoredPref[]> {
  let prefs: StoredPref[] = [];
  for (let i = 0; i < tries; i++) {
    prefs = await call<StoredPref[]>(handle, {
      action: 'listPreferences',
      owner,
    });
    if (prefs.length >= min) return prefs;
    await new Promise((r) => setTimeout(r, 25));
  }
  return prefs;
}

beforeAll(async () => {
  const bundle = await buildWorkerBundle(harness, {
    sourcefile: 'authoring-profile-harness.ts',
  });
  const durableObjects = {
    DOC: { className: 'TopologyDocument', useSQLite: true },
    AUTHORING_PROFILE: { className: 'AuthoringProfile', useSQLite: true },
  };
  on = await startMiniflare({
    bundle,
    durableObjects,
    vars: { PROFILES_ENABLED: 'true' },
  });
  // A second instance shares the bundle file; dispose only the first handle's
  // bundle to avoid a double unlink of the same path.
  off = await startMiniflare({
    bundle: { path: bundle.path, dispose: async () => {} },
    durableObjects,
  });
}, 30_000);

afterAll(async () => {
  await off?.dispose();
  await on?.dispose();
});

describe('AuthoringProfile Durable Object', () => {
  it('dedupes by (rule, scope): repeated distinct outcomes strengthen one candidate', async () => {
    const owner = 'dedupe-1';
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r5' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r9' }),
    });
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.supportingOutcomes).toBe(2);
    expect(prefs[0]!.evidenceDocuments).toBe(1); // same document w1
    expect(prefs[0]!.status).toBe('candidate');
    expect(prefs[0]!.trigger.requiredTraits).toEqual([
      'layered-regional',
      'spokes-below-hub',
    ]);
    expect(prefs[0]!.trigger.excludedTraits).toEqual(['radial-placement']);
  }, 30_000);

  it('raises the evidence-document count across distinct documents', async () => {
    const owner = 'dedupe-2';
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r5', documentRef: 'w1' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w2@r3', documentRef: 'w2' }),
    });
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.supportingOutcomes).toBe(2);
    expect(prefs[0]!.evidenceDocuments).toBe(2);
  }, 30_000);

  it('coalesces a burst: the same source ref never double-counts', async () => {
    const owner = 'burst-1';
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r5' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r5' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w1@r5' }),
    });
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.supportingOutcomes).toBe(1);
    expect(prefs[0]!.sourceRevisionRefs).toEqual(['w1@r5']);
  }, 30_000);

  it('keeps structurally different corrections as separate candidates', async () => {
    const owner = 'distinct-1';
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ addedTraits: ['ta'], sourceRevisionRef: 'w1@r1' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ addedTraits: ['tb'], sourceRevisionRef: 'w1@r2' }),
    });
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs).toHaveLength(2);
  }, 30_000);

  it('enforces the per-owner candidate cap by evicting the weakest', async () => {
    const owner = 'bounds-1';
    const over = MAX_CANDIDATES_PER_OWNER + 5;
    for (let i = 0; i < over; i++) {
      await call(on, {
        action: 'recordOutcome',
        owner,
        outcome: outcome({
          addedTraits: [`trait-${i}`],
          sourceRevisionRef: `w1@r${i}`,
        }),
      });
    }
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs.length).toBe(MAX_CANDIDATES_PER_OWNER);
  }, 120_000);

  it('isolates candidates across owners', async () => {
    const a = 'iso-a';
    const b = 'iso-b';
    await call(on, {
      action: 'recordOutcome',
      owner: a,
      outcome: outcome({ addedTraits: ['only-a'], sourceRevisionRef: 'wa@r1' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner: b,
      outcome: outcome({ addedTraits: ['only-b'], sourceRevisionRef: 'wb@r1' }),
    });
    const prefsA = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner: a,
    });
    const prefsB = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner: b,
    });
    expect(prefsA).toHaveLength(1);
    expect(prefsB).toHaveLength(1);
    expect(prefsA[0]!.trigger.requiredTraits).toEqual(['only-a']);
    expect(prefsB[0]!.trigger.requiredTraits).toEqual(['only-b']);
    expect(prefsA[0]!.ownerId).toBe(a);
    expect(prefsB[0]!.ownerId).toBe(b);
  }, 30_000);
});

describe('owner manage actions (Packet P3: pause / resume / forget)', () => {
  it('round-trips pause↔resume and bumps profileRevision once per real change', async () => {
    const owner = 'manage-1';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    const before = await call<{ profileRevision: number }>(on, {
      action: 'getProfile',
      owner,
    });
    expect(before.profileRevision).toBe(0);

    const paused = await call<StoredPref>(on, {
      action: 'setStatus',
      owner,
      preferenceId: pref!.id,
      status: 'paused',
    });
    expect(paused.status).toBe('paused');
    // Paused candidates stay listed (visible, just held back from future P4
    // retrieval) and the revision bumped for the change…
    const listed = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('paused');
    const afterPause = await call<{ profileRevision: number }>(on, {
      action: 'getProfile',
      owner,
    });
    expect(afterPause.profileRevision).toBe(1);

    // …a repeated pause is a no-op (no revision bump)…
    await call(on, {
      action: 'setStatus',
      owner,
      preferenceId: pref!.id,
      status: 'paused',
    });
    const afterRepeat = await call<{ profileRevision: number }>(on, {
      action: 'getProfile',
      owner,
    });
    expect(afterRepeat.profileRevision).toBe(1);

    // …and resume restores 'candidate' with another bump.
    const resumed = await call<StoredPref>(on, {
      action: 'setStatus',
      owner,
      preferenceId: pref!.id,
      status: 'candidate',
    });
    expect(resumed.status).toBe('candidate');
    const afterResume = await call<{ profileRevision: number }>(on, {
      action: 'getProfile',
      owner,
    });
    expect(afterResume.profileRevision).toBe(2);
  }, 30_000);

  it('setStatus only pauses/resumes — a confirm smuggled through it is refused', async () => {
    const owner = 'manage-2';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    await expect(
      call(on, {
        action: 'setStatus',
        owner,
        preferenceId: pref!.id,
        status: 'confirmed',
      }),
    ).rejects.toThrow(/only pause\/resume/);
    const listed = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(listed[0]!.status).toBe('candidate');
  }, 30_000);

  it('forget deletes the record, bumps the revision, and 404s a repeat', async () => {
    const owner = 'manage-3';
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ addedTraits: ['keep'], sourceRevisionRef: 'w1@r1' }),
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ addedTraits: ['drop'], sourceRevisionRef: 'w1@r2' }),
    });
    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    const victim = prefs.find((p) => p.trigger.requiredTraits.includes('drop'));
    await call(on, {
      action: 'deletePreference',
      owner,
      preferenceId: victim!.id,
    });
    const remaining = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.trigger.requiredTraits).toContain('keep');
    const view = await call<{ profileRevision: number }>(on, {
      action: 'getProfile',
      owner,
    });
    expect(view.profileRevision).toBe(1);
    await expect(
      call(on, {
        action: 'deletePreference',
        owner,
        preferenceId: victim!.id,
      }),
    ).rejects.toThrow(/unknown preference/);
  }, 30_000);

  it('asserts the owner: a mismatched caller can neither pause nor forget', async () => {
    const owner = 'manage-a';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    await expect(
      call(on, {
        action: 'setStatus',
        owner,
        asOwner: 'manage-intruder',
        preferenceId: pref!.id,
        status: 'paused',
      }),
    ).rejects.toThrow(/access denied/);
    await expect(
      call(on, {
        action: 'deletePreference',
        owner,
        asOwner: 'manage-intruder',
        preferenceId: pref!.id,
      }),
    ).rejects.toThrow(/access denied/);
    const listed = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('candidate');
  }, 30_000);
});

describe('owner confirm / reject + bounded guidance retrieval (Packet P4)', () => {
  it('confirm promotes at the chosen scope, bumps the revision, and guidance serves the rule', async () => {
    const owner = 'p4-confirm';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });

    // Candidates are never served (acceptance criterion 1: one correction
    // changes nothing without confirmation) — product pack only.
    const query = { archetype: 'multi-region-hub-spoke' };
    const before = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });
    expect(before.rules!.every((rule) => rule.scope === 'product')).toBe(true);

    const confirmed = await call<StoredPref>(on, {
      action: 'confirm',
      owner,
      preferenceId: pref!.id,
      scope: { kind: 'archetype', archetype: 'multi-region-hub-spoke' },
    });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.scope).toEqual({
      kind: 'archetype',
      archetype: 'multi-region-hub-spoke',
    });
    expect(confirmed.confidence).toBeGreaterThan(0);
    expect(confirmed.confirmedAt).toBeTruthy();

    const after = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });
    expect(after.profileRevision).toBe(before.profileRevision + 1);
    expect(after.rules![0]!.id).toBe(pref!.id);
    expect(after.rules![0]!.scope).toBe('archetype:multi-region-hub-spoke');

    // Unchanged revisions → notModified with no instruction body.
    const unchanged = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query: {
        ...query,
        lastProfileRevision: after.profileRevision,
        lastGuidanceRevision: after.guidanceRevision,
      },
    });
    expect(unchanged.notModified).toBe(true);
    expect(unchanged.rules).toBeUndefined();

    // A malformed confirm scope throws instead of silently widening.
    await expect(
      call(on, {
        action: 'confirm',
        owner,
        preferenceId: pref!.id,
        scope: { kind: 'workspace' },
      }),
    ).rejects.toThrow(/invalid preference scope/);
  }, 30_000);

  it('pausing a confirmed rule stops serving it; resume restores confirmed, not candidate', async () => {
    const owner = 'p4-pause';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    await call(on, {
      action: 'confirm',
      owner,
      preferenceId: pref!.id,
      scope: { kind: 'user' },
    });
    const query = { archetype: 'multi-region-hub-spoke' };

    const paused = await call<StoredPref>(on, {
      action: 'setStatus',
      owner,
      preferenceId: pref!.id,
      status: 'paused',
    });
    expect(paused.status).toBe('paused');
    const whilePaused = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });
    expect(whilePaused.rules!.some((rule) => rule.id === pref!.id)).toBe(false);

    const resumed = await call<StoredPref>(on, {
      action: 'setStatus',
      owner,
      preferenceId: pref!.id,
      status: 'candidate',
    });
    expect(resumed.status).toBe('confirmed'); // confirmedAt survives the pause
    const afterResume = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });
    expect(afterResume.rules![0]!.id).toBe(pref!.id);
  }, 30_000);

  it('reject tombstones the rule: not served, not re-learnable, only forgettable', async () => {
    const owner = 'p4-reject';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    const rejected = await call<StoredPref>(on, {
      action: 'reject',
      owner,
      preferenceId: pref!.id,
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.confidence).toBe(0);

    // The same structural correction from a NEW burst is dropped, not
    // re-created and not strengthened.
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: outcome({ sourceRevisionRef: 'w7@r1', documentRef: 'w7' }),
    });
    const listed = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('rejected');
    expect(listed[0]!.supportingOutcomes).toBe(1);

    // Pause/resume and re-confirm are refused; forget remains available.
    await expect(
      call(on, {
        action: 'setStatus',
        owner,
        preferenceId: pref!.id,
        status: 'paused',
      }),
    ).rejects.toThrow(/only be forgotten/);
    await expect(
      call(on, {
        action: 'confirm',
        owner,
        preferenceId: pref!.id,
        scope: { kind: 'user' },
      }),
    ).rejects.toThrow(/only be forgotten/);
  }, 30_000);

  it('asserts the owner on confirm, reject, and guidance', async () => {
    const owner = 'p4-owner';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    for (const action of ['confirm', 'reject'] as const) {
      await expect(
        call(on, {
          action,
          owner,
          asOwner: 'p4-intruder',
          preferenceId: pref!.id,
          scope: { kind: 'user' },
        }),
      ).rejects.toThrow(/access denied/);
    }
    await expect(
      call(on, {
        action: 'guidance',
        owner,
        asOwner: 'p4-intruder',
        query: {},
      }),
    ).rejects.toThrow(/access denied/);
    const listed = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(listed[0]!.status).toBe('candidate');
  }, 30_000);
});

describe('outcome refinement: contradictions, exceptions, review (Packet P5)', () => {
  it('an overriding correction records a scoped exception, bumps the revision, and narrows serving', async () => {
    const owner = 'p5-contra';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    await call(on, {
      action: 'confirm',
      owner,
      preferenceId: pref!.id,
      scope: { kind: 'user' },
    });
    const query = { archetype: 'multi-region-hub-spoke' };
    const before = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });

    // The user overrides the rule in workspace w9: the reverse trait diff.
    const reversalOutcome = outcome({
      addedTraits: ['radial-placement'],
      removedTraits: ['layered-regional', 'spokes-below-hub'],
      sourceRevisionRef: 'w9@r3',
      documentRef: 'w9',
      summary: 'layered regional → radial hub placement',
    });
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: reversalOutcome,
    });

    const prefs = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    const rule = prefs.find((p) => p.id === pref!.id)!;
    expect(rule.contradictingOutcomes).toBe(1);
    expect(rule.exceptionWorkspaceIds).toEqual(['w9']);
    expect(rule.status).toBe('confirmed'); // never silently disabled
    // The reverse correction ALSO becomes its own fresh candidate.
    expect(prefs.filter((p) => p.id !== pref!.id)).toHaveLength(1);
    expect(prefs.find((p) => p.id !== pref!.id)!.status).toBe('candidate');

    // The contradiction bumped the revision (exceptions change serving)…
    const after = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query,
    });
    expect(after.profileRevision).toBe(before.profileRevision + 1);
    // …and the rule no longer serves in w9 while serving elsewhere.
    const inW9 = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query: { ...query, workspaceId: 'w9' },
    });
    expect(inW9.rules!.some((r) => r.id === pref!.id)).toBe(false);
    const inW1 = await call<GuidanceBody>(on, {
      action: 'guidance',
      owner,
      query: { ...query, workspaceId: 'w1' },
    });
    expect(inW1.rules!.some((r) => r.id === pref!.id)).toBe(true);

    // Burst coalescing: re-delivering the same reversal changes nothing.
    await call(on, {
      action: 'recordOutcome',
      owner,
      outcome: reversalOutcome,
    });
    const repeat = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    expect(repeat.find((p) => p.id === pref!.id)!.contradictingOutcomes).toBe(
      1,
    );
  }, 30_000);

  it('a second independent contradiction flags review; re-confirm clears it', async () => {
    const owner = 'p5-review';
    await call(on, { action: 'recordOutcome', owner, outcome: outcome() });
    const [pref] = await call<StoredPref[]>(on, {
      action: 'listPreferences',
      owner,
    });
    await call(on, {
      action: 'confirm',
      owner,
      preferenceId: pref!.id,
      scope: { kind: 'user' },
    });
    for (const [ref, doc] of [
      ['w8@r1', 'w8'],
      ['w9@r1', 'w9'],
    ] as const) {
      await call(on, {
        action: 'recordOutcome',
        owner,
        outcome: outcome({
          addedTraits: ['radial-placement'],
          removedTraits: ['layered-regional'],
          sourceRevisionRef: ref,
          documentRef: doc,
        }),
      });
    }
    const flagged = (
      await call<StoredPref[]>(on, { action: 'listPreferences', owner })
    ).find((p) => p.id === pref!.id)!;
    expect(flagged.contradictingOutcomes).toBe(2);
    expect(flagged.needsReview).toBe(true);
    expect(flagged.exceptionWorkspaceIds).toEqual(['w8', 'w9']);

    const reconfirmed = await call<StoredPref>(on, {
      action: 'confirm',
      owner,
      preferenceId: pref!.id,
      scope: { kind: 'user' },
    });
    expect(reconfirmed.needsReview).toBeUndefined();
    expect(reconfirmed.exceptionWorkspaceIds).toEqual(['w8', 'w9']); // kept
  }, 30_000);
});

describe('observe-only coordinator emission (PROFILES_ENABLED gate)', () => {
  it('with the flag OFF: emits nothing and leaves coordinator responses unchanged', async () => {
    const owner = 'e2e-off';
    const offRun = await runObserveSequence(off, owner);
    // Give any (non-scheduled) work a chance, then assert the profile is empty.
    await new Promise((r) => setTimeout(r, 100));
    const prefs = await call<StoredPref[]>(off, {
      action: 'listPreferences',
      owner,
    });
    expect(prefs).toHaveLength(0);

    // The coordinator responses must be byte-for-byte identical to the flag-ON
    // run: CommitResult carries no ids/timestamps, so it is directly comparable.
    const onRun = await runObserveSequence(on, 'e2e-on');
    expect(offRun.accept).toEqual(onRun.accept);
    expect(offRun.userCommit).toEqual(onRun.userCommit);
    expect(offRun.checkpoint.revision).toBe(onRun.checkpoint.revision);
    expect(offRun.checkpoint.pageCount).toBe(onRun.checkpoint.pageCount);

    // And the flag-ON run DID learn exactly one candidate from the correction.
    const learned = await pollProfile(on, 'e2e-on', 1);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.status).toBe('candidate');
    expect(learned[0]!.trigger.requiredTraits).toContain('spokes-below-hub');
    expect(learned[0]!.trigger.excludedTraits).toEqual(['radial-placement']);
    expect(learned[0]!.supportingOutcomes).toBe(1);
    expect(learned[0]!.evidenceDocuments).toBe(1);
  }, 60_000);

  it('with the flag ON: an accept → correct → checkpoint burst yields exactly one outcome', async () => {
    const owner = 'e2e-one';
    await runObserveSequence(on, owner);
    const prefs = await pollProfile(on, owner, 1);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]!.sourceRevisionRefs).toHaveLength(1); // one burst → one ref
    expect(prefs[0]!.supportingOutcomes).toBe(1);
  }, 60_000);
});
