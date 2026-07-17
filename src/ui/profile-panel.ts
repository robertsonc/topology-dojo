/**
 * Authoring Preferences panel (Packets P3+P4 / proposal 0003-A/B).
 *
 * An owner-facing surface over the learned preference records the
 * `AuthoringProfile` DO accumulates: each row shows the rule's directive,
 * rationale, scope, status, and evidence summary, with per-row Pause/Resume
 * and Forget actions. Packet P4 adds the confirmation flow — "Make this a
 * preference…" opens an inline scope chooser (all my diagrams / only this
 * archetype / only the evidence workspace / don't learn this), the proposal's
 * §"Confirm and scope" question. This browser panel is the ONLY confirm
 * surface: agents can retrieve and explain rules over MCP but never confirm,
 * broaden, or undelete them.
 *
 * Follows `workspace-panel.ts` conventions: pure `render*Html` string builders
 * (characterization-testable without a DOM — see `profile-panel.test.ts`) plus
 * one `mountProfilePanel(host)` controller that owns the panel DOM, fetching,
 * and action wiring behind a narrow host seam.
 */
import {
  confirmAuthoringPreference,
  forgetAuthoringPreference,
  listAuthoringPreferences,
  pauseAuthoringPreference,
  ProfilesDisabledError,
  rejectAuthoringPreference,
  resumeAuthoringPreference,
} from '../profile/client.js';
import { documentRefOf } from '../profile/learner.js';
import { staleForReview } from '../profile/refinement.js';
import type { AuthoringPreference, PreferenceScope } from '../profile/model.js';

// Local copy of main.ts's `esc()` — the codebase's established pattern for
// this trivial helper (see `src/ui/workspace-panel.ts`, `src/nodes/render.ts`)
// is a small per-module copy rather than a shared import.
function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Pure: a human label for where a preference applies. */
export function preferenceScopeLabel(scope: PreferenceScope): string {
  switch (scope?.kind) {
    case 'workspace':
      return `workspace ${scope.workspaceId}`;
    case 'archetype':
      return `${scope.archetype} diagrams`;
    default:
      return 'all my diagrams';
  }
}

/** Pure: the compact evidence line for one candidate — counts only, never
 * document content (the stored refs are already bounded opaque ids and are not
 * shown). The date is the ISO day of `lastObservedAt` so output is
 * deterministic across locales/timezones. */
export function formatEvidenceSummary(pref: AuthoringPreference): string {
  const outcomes = `${pref.supportingOutcomes} outcome${pref.supportingOutcomes === 1 ? '' : 's'}`;
  const documents = `${pref.evidenceDocuments} document${pref.evidenceDocuments === 1 ? '' : 's'}`;
  return `${outcomes} · ${documents} · last observed ${pref.lastObservedAt.slice(0, 10)}`;
}

/** Pure: the panel body when the profile surface is disabled on this
 * deployment (`PROFILES_ENABLED` gate — mirrors the workspace panel's
 * disabled notice). */
export function renderProfileDisabledHtml(): string {
  return (
    `<div class="ws-note">Authoring preferences are not enabled on this deployment.</div>` +
    `<div class="ws-card"><div class="ws-note">Preference learning is turned off for this deployment. Editing and agent workspaces work as usual.</div>` +
    `<div class="ws-actions"><button class="tbtn" id="prefRefresh">Check again</button></div></div>`
  );
}

/** The proposal's "ask" threshold (§"Create or strengthen a candidate"):
 * three independent corrections across at least two documents is when the
 * panel actively asks the causal question instead of a passive note. */
export function shouldAskToConfirm(pref: AuthoringPreference): boolean {
  return (
    pref.status === 'candidate' &&
    pref.supportingOutcomes >= 3 &&
    pref.evidenceDocuments >= 2
  );
}

/** Pure: the inline scope chooser for one candidate — the proposal's
 * §"Confirm and scope" choices. The workspace option only appears when ALL
 * evidence came from one workspace (its documentRef); the archetype option
 * only when the trigger detected one. */
export function renderScopeChooserHtml(pref: AuthoringPreference): string {
  const id = esc(pref.id);
  const archetype = pref.trigger.archetype;
  const documentRefs = [...new Set(pref.sourceRevisionRefs.map(documentRefOf))];
  const workspaceRef = documentRefs.length === 1 ? documentRefs[0]! : null;
  return (
    `<div class="ws-card pref-scope-chooser" data-pref="${id}">` +
    `<div class="ws-note">Where should this preference apply?</div>` +
    `<div class="ws-actions">` +
    `<button class="tbtn pref-scope-option" data-pref-id="${id}" data-scope-kind="user">All my diagrams</button>` +
    (archetype
      ? `<button class="tbtn pref-scope-option" data-pref-id="${id}" data-scope-kind="archetype" data-scope-archetype="${esc(archetype)}">Only ${esc(archetype)} diagrams</button>`
      : '') +
    (workspaceRef
      ? `<button class="tbtn pref-scope-option" data-pref-id="${id}" data-scope-kind="workspace" data-scope-workspace="${esc(workspaceRef)}">Only workspace ${esc(workspaceRef)}</button>`
      : '') +
    `<button class="tbtn pref-reject" data-pref-id="${id}">Don’t learn this</button>` +
    `<button class="tbtn pref-confirm-cancel" data-pref-id="${id}">Cancel</button>` +
    `</div></div>`
  );
}

/** Pure: one rule's card — directive, status badge, rationale, scope, the
 * callouts (needs-review from contradictions first, then the ask/observed
 * ladder, confirmed/rejected notes, and the stale-toward-review note),
 * the exceptions line, evidence summary, and the per-status actions. Only
 * the browser owner ever sees a confirm affordance — there is no MCP
 * equivalent. */
function renderPreferenceCardHtml(
  pref: AuthoringPreference,
  confirmingId: string | null,
  now: string | null,
): string {
  const paused = pref.status === 'paused';
  const rejected = pref.status === 'rejected';
  const confirmed = pref.status === 'confirmed';
  let callout = '';
  if (pref.needsReview) {
    callout = confirmed
      ? `<div class="ws-note pref-review">⚠ Overridden ${pref.contradictingOutcomes}× by your corrections — review it: re-confirm, rescope, or reject.</div>`
      : `<div class="ws-note pref-review">⚠ Conflicting evidence (${pref.contradictingOutcomes} contradiction${pref.contradictingOutcomes === 1 ? '' : 's'}) — confirm the direction you want, or forget it.</div>`;
  } else if (shouldAskToConfirm(pref)) {
    callout = `<div class="ws-note pref-ask">◎ You have made this correction ${pref.supportingOutcomes} times across ${pref.evidenceDocuments} documents. Should Topology Dojo prefer it in future agent-authored diagrams?</div>`;
  } else if (pref.status === 'candidate' && pref.supportingOutcomes >= 2) {
    callout = `<div class="ws-note pref-observed">◎ Observed ${pref.supportingOutcomes}× — a repeated pattern. It changes nothing until you confirm it.</div>`;
  } else if (confirmed) {
    callout = `<div class="ws-note pref-confirmed-note">✓ Confirmed${pref.confirmedAt ? ` ${pref.confirmedAt.slice(0, 10)}` : ''} — supplied to agents when it applies.</div>`;
  } else if (rejected) {
    callout = `<div class="ws-note pref-rejected-note">✕ Rejected — this pattern will not be learned again. Forget it to clear the record.</div>`;
  }
  const stale =
    now && staleForReview(pref, now)
      ? `<div class="ws-note pref-stale">◌ Not observed since ${pref.lastObservedAt.slice(0, 10)} — stale. Keep, pause, or forget it.</div>`
      : '';
  const exceptions = pref.exceptionWorkspaceIds?.length
    ? `<div class="ws-note pref-exceptions">Except in: ${pref.exceptionWorkspaceIds.map((id) => esc(id)).join(', ')}</div>`
    : '';
  const confirmable =
    pref.status === 'candidate' || (confirmed && pref.needsReview);
  const actions = rejected
    ? `<button class="tbtn pref-forget" data-pref-id="${esc(pref.id)}">Forget</button>`
    : (confirmable
        ? `<button class="tbtn pref-confirm-open" data-pref-id="${esc(pref.id)}">${confirmed ? 'Re-confirm…' : 'Make this a preference…'}</button>`
        : '') +
      `<button class="tbtn ${paused ? 'pref-resume' : 'pref-pause'}" data-pref-id="${esc(pref.id)}">${paused ? 'Resume' : 'Pause'}</button>` +
      `<button class="tbtn pref-forget" data-pref-id="${esc(pref.id)}">Forget</button>`;
  return (
    `<div class="ws-card pref-card" data-pref="${esc(pref.id)}">` +
    `<div class="ws-row"><span class="ws-v pref-directive">${esc(pref.directive)}</span>` +
    `<span class="ws-badge pref-status-${esc(pref.status)}">${esc(pref.status)}</span></div>` +
    (pref.rationale && pref.rationale !== pref.directive
      ? `<div class="ws-note pref-rationale">${esc(pref.rationale)}</div>`
      : '') +
    `<div class="ws-note pref-scope">Scope: ${esc(preferenceScopeLabel(pref.scope))}</div>` +
    exceptions +
    callout +
    stale +
    `<div class="ws-note pref-evidence">${esc(formatEvidenceSummary(pref))}</div>` +
    `<div class="ws-actions">${actions}</div>` +
    (confirmingId === pref.id ? renderScopeChooserHtml(pref) : '') +
    `</div>`
  );
}

/** Pure: the list body — an explainer plus one card per learned rule (or the
 * empty state). `now` (an ISO timestamp) enables the stale-toward-review
 * notes; omit it for time-independent rendering. */
export function renderPreferencesHtml(
  prefs: AuthoringPreference[],
  confirmingId: string | null = null,
  now: string | null = null,
): string {
  const intro =
    `<div class="ws-note">Patterns observed from your corrections to agent-authored diagrams. ` +
    `Only rules you confirm are supplied to agents — and you can pause or forget them at any time.</div>`;
  if (!prefs.length) {
    return (
      intro +
      `<div class="ws-card"><div class="ws-empty">No learned candidates yet. When you repeatedly correct agent work the same way, the pattern will appear here.</div></div>`
    );
  }
  return (
    intro +
    prefs.map((p) => renderPreferenceCardHtml(p, confirmingId, now)).join('')
  );
}

/** The panel controller's render state (kept pure-renderable for tests). */
export interface ProfilePanelState {
  loading: boolean;
  /** The deployment has `PROFILES_ENABLED` off (typed 503 from the client). */
  disabled: boolean;
  /** Last action/fetch failure to surface (non-fatal; list stays shown). */
  error: string | null;
  preferences: AuthoringPreference[];
  /** The card whose inline scope chooser is open (Packet P4), if any. */
  confirmingId: string | null;
  /** Render-time ISO timestamp for stale notes (Packet P5); null disables. */
  now: string | null;
}

/** Pure: the whole panel body for a given state. */
export function renderProfileBodyHtml(state: ProfilePanelState): string {
  if (state.disabled) return renderProfileDisabledHtml();
  return (
    (state.error ? `<div class="ws-error">${esc(state.error)}</div>` : '') +
    (state.loading
      ? `<div class="ws-note">Loading preferences…</div>`
      : renderPreferencesHtml(state.preferences, state.confirmingId, state.now))
  );
}

/** Everything the panel needs from `main.ts`'s app shell — the narrow seam. */
export interface ProfilePanelHost {
  /** The `#profileChip` toolbar button (hidden until sign-in). */
  chip: HTMLButtonElement;
}

/** The call sites `main.ts` needs into the panel. */
export interface ProfilePanelHandle {
  /** Reveals the toolbar chip once sign-in is confirmed. */
  enable(): void;
}

export function mountProfilePanel(host: ProfilePanelHost): ProfilePanelHandle {
  let panel: HTMLElement | null = null;
  const state: ProfilePanelState = {
    loading: false,
    disabled: false,
    error: null,
    preferences: [],
    confirmingId: null,
    now: null,
  };

  function closePanel(): void {
    panel?.remove();
    panel = null;
    host.chip.setAttribute('aria-expanded', 'false');
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function refresh(): Promise<void> {
    state.loading = true;
    state.error = null;
    state.now = new Date().toISOString();
    renderPanel();
    try {
      state.preferences = await listAuthoringPreferences();
      state.disabled = false;
    } catch (error) {
      state.preferences = [];
      if (error instanceof ProfilesDisabledError) state.disabled = true;
      else state.error = describe(error);
    }
    state.loading = false;
    renderPanel();
  }

  /** Run one manage action, then re-fetch the list (the DO is the source of
   * truth — no optimistic local mutation to drift). Any open scope chooser
   * closes: after an action the list re-renders from fresh server state. */
  function runAction(action: Promise<unknown>): void {
    state.confirmingId = null;
    void action
      .then(() => refresh())
      .catch((error) => {
        state.error = describe(error);
        renderPanel();
      });
  }

  function renderPanel(): void {
    if (!panel) return;
    const body = panel.querySelector<HTMLElement>('#prefBody');
    if (!body) return;
    body.innerHTML = renderProfileBodyHtml(state);
    body
      .querySelector('#prefRefresh')
      ?.addEventListener('click', () => void refresh());
    body
      .querySelectorAll<HTMLButtonElement>('.pref-pause')
      .forEach((button) =>
        button.addEventListener('click', () =>
          runAction(pauseAuthoringPreference(button.dataset.prefId!)),
        ),
      );
    body
      .querySelectorAll<HTMLButtonElement>('.pref-resume')
      .forEach((button) =>
        button.addEventListener('click', () =>
          runAction(resumeAuthoringPreference(button.dataset.prefId!)),
        ),
      );
    body
      .querySelectorAll<HTMLButtonElement>('.pref-confirm-open')
      .forEach((button) =>
        button.addEventListener('click', () => {
          state.confirmingId = button.dataset.prefId!;
          renderPanel();
        }),
      );
    body
      .querySelectorAll<HTMLButtonElement>('.pref-confirm-cancel')
      .forEach((button) =>
        button.addEventListener('click', () => {
          state.confirmingId = null;
          renderPanel();
        }),
      );
    body
      .querySelectorAll<HTMLButtonElement>('.pref-scope-option')
      .forEach((button) =>
        button.addEventListener('click', () => {
          const kind = button.dataset.scopeKind;
          const scope: PreferenceScope =
            kind === 'workspace'
              ? {
                  kind: 'workspace',
                  workspaceId: button.dataset.scopeWorkspace!,
                }
              : kind === 'archetype'
                ? {
                    kind: 'archetype',
                    archetype: button.dataset.scopeArchetype!,
                  }
                : { kind: 'user' };
          runAction(confirmAuthoringPreference(button.dataset.prefId!, scope));
        }),
      );
    body
      .querySelectorAll<HTMLButtonElement>('.pref-reject')
      .forEach((button) =>
        button.addEventListener('click', () =>
          runAction(rejectAuthoringPreference(button.dataset.prefId!)),
        ),
      );
    body.querySelectorAll<HTMLButtonElement>('.pref-forget').forEach((button) =>
      button.addEventListener('click', () => {
        if (
          !confirm(
            'Forget this learned pattern? Its evidence is deleted and cannot be restored.',
          )
        )
          return;
        runAction(forgetAuthoringPreference(button.dataset.prefId!));
      }),
    );
  }

  function openPanel(): void {
    if (panel) {
      closePanel();
      return;
    }
    panel = document.createElement('div');
    panel.className = 'workspace-panel profile-panel scroll-slim';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Authoring Preferences');
    panel.innerHTML =
      `<div class="ws-head"><h3>Authoring Preferences</h3><button class="tbtn ticon" id="prefClose" title="Close">✕</button></div>` +
      `<div id="prefBody"></div>`;
    document.body.appendChild(panel);
    panel
      .querySelector('#prefClose')
      ?.addEventListener('click', () => closePanel());
    host.chip.setAttribute('aria-expanded', 'true');
    void refresh();
  }

  function enable(): void {
    host.chip.hidden = false;
    host.chip.addEventListener('click', (event) => {
      event.stopPropagation();
      openPanel();
    });
  }

  return { enable };
}
