/**
 * Authoring Preferences panel (Packet P3 / proposal 0003-A, observe-only).
 *
 * An owner-facing surface over the learned preference *candidates* the
 * `AuthoringProfile` DO accumulates (Packet P2): each row shows the candidate's
 * directive, rationale, scope, status, and evidence summary, with per-row
 * Pause/Resume and Forget actions. Strictly observe-only — nothing here (or in
 * the routes it calls) changes agent output; pause/forget affect only what the
 * owner sees and what a future Packet P4 retrieval would serve. Confirmation
 * and scoping ("Yes, for my multi-region diagrams…") are Packet P4, so no
 * confirm affordance exists here by construction.
 *
 * Follows `workspace-panel.ts` conventions: pure `render*Html` string builders
 * (characterization-testable without a DOM — see `profile-panel.test.ts`) plus
 * one `mountProfilePanel(host)` controller that owns the panel DOM, fetching,
 * and action wiring behind a narrow host seam.
 */
import {
  forgetAuthoringPreference,
  listAuthoringPreferences,
  pauseAuthoringPreference,
  ProfilesDisabledError,
  resumeAuthoringPreference,
} from '../profile/client.js';
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

/** Pure: one candidate's card — directive, status badge, rationale, scope,
 * the 2+ observation callout (proposal §"Create or strengthen a candidate":
 * one outcome is evidence only; two or more show a non-blocking "observed"
 * note), evidence summary, and the Pause/Resume + Forget actions. */
function renderPreferenceCardHtml(pref: AuthoringPreference): string {
  const paused = pref.status === 'paused';
  const observed =
    pref.supportingOutcomes >= 2
      ? `<div class="ws-note pref-observed">◎ Observed ${pref.supportingOutcomes}× — a repeated pattern. It still changes nothing until you confirm it (coming in a later update).</div>`
      : '';
  return (
    `<div class="ws-card pref-card" data-pref="${esc(pref.id)}">` +
    `<div class="ws-row"><span class="ws-v pref-directive">${esc(pref.directive)}</span>` +
    `<span class="ws-badge pref-status-${esc(pref.status)}">${esc(pref.status)}</span></div>` +
    (pref.rationale && pref.rationale !== pref.directive
      ? `<div class="ws-note pref-rationale">${esc(pref.rationale)}</div>`
      : '') +
    `<div class="ws-note pref-scope">Scope: ${esc(preferenceScopeLabel(pref.scope))}</div>` +
    observed +
    `<div class="ws-note pref-evidence">${esc(formatEvidenceSummary(pref))}</div>` +
    `<div class="ws-actions">` +
    `<button class="tbtn ${paused ? 'pref-resume' : 'pref-pause'}" data-pref-id="${esc(pref.id)}">${paused ? 'Resume' : 'Pause'}</button>` +
    `<button class="tbtn pref-forget" data-pref-id="${esc(pref.id)}">Forget</button>` +
    `</div></div>`
  );
}

/** Pure: the list body — an observe-only explainer plus one card per learned
 * candidate (or the empty state). */
export function renderPreferencesHtml(prefs: AuthoringPreference[]): string {
  const intro =
    `<div class="ws-note">Patterns observed from your corrections to agent-authored diagrams. ` +
    `Observe-only: nothing here changes agent behavior yet.</div>`;
  if (!prefs.length) {
    return (
      intro +
      `<div class="ws-card"><div class="ws-empty">No learned candidates yet. When you repeatedly correct agent work the same way, the pattern will appear here.</div></div>`
    );
  }
  return intro + prefs.map(renderPreferenceCardHtml).join('');
}

/** The panel controller's render state (kept pure-renderable for tests). */
export interface ProfilePanelState {
  loading: boolean;
  /** The deployment has `PROFILES_ENABLED` off (typed 503 from the client). */
  disabled: boolean;
  /** Last action/fetch failure to surface (non-fatal; list stays shown). */
  error: string | null;
  preferences: AuthoringPreference[];
}

/** Pure: the whole panel body for a given state. */
export function renderProfileBodyHtml(state: ProfilePanelState): string {
  if (state.disabled) return renderProfileDisabledHtml();
  return (
    (state.error ? `<div class="ws-error">${esc(state.error)}</div>` : '') +
    (state.loading
      ? `<div class="ws-note">Loading preferences…</div>`
      : renderPreferencesHtml(state.preferences))
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
   * truth — no optimistic local mutation to drift). */
  function runAction(action: Promise<unknown>): void {
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
