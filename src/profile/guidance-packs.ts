/**
 * Versioned product guidance packs (Packet P4 / proposal 0003-B).
 *
 * Product-level authoring directives live HERE — in reviewed, versioned code —
 * never in per-user profiles, and per-user learning can never write into this
 * file (proposal guardrail #9: "no personal lesson becomes general MCP
 * guidance without maintainer review… and a released version"). Changing any
 * rule, adding one, or removing one REQUIRES bumping {@link GUIDANCE_REVISION}
 * in the same commit: `get_authoring_guidance` callers cache compiled output
 * against `(profileRevision, guidanceRevision)` and rely on `notModified`
 * short-circuits, so an unbumped edit would be invisible to every agent that
 * already holds the old revision.
 *
 * Pack rules are deliberately few and short — they share the same hard token
 * budget as user preferences (`guidance.ts`) and rank BELOW them: the
 * proposal's precedence is task instructions > workspace conventions > user
 * preferences > product defaults. v1 restates only guidance the product
 * already ships elsewhere (the `layout_guidelines` tool and proposal 0003's
 * reviewed multi-region example) rather than inventing new policy.
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md ("MCP
 *      evolution model", "Three classes of knowledge").
 */

/**
 * Bumped on ANY change to {@link GUIDANCE_PACK_RULES}. Combined with
 * `profileRevision` it forms the guidance cache key and the `notModified`
 * check in `AuthoringProfile.getGuidance`.
 */
export const GUIDANCE_REVISION = 1;

/** One product directive. `id`s are stable, namespaced `gp<pack-revision>:`
 * so a rule surviving into a later pack revision keeps its identity. */
export interface GuidancePackRule {
  id: string;
  /** Restricts the rule to one detected archetype (`src/profile/features.ts`
   * vocabulary); omitted means it applies to every authoring task. */
  archetype?: string;
  /** Concise instruction supplied to the agent — prose is never truncated, so
   * keep each directive comfortably small (a sentence or two). */
  directive: string;
}

export const GUIDANCE_PACK_RULES: readonly GuidancePackRule[] = [
  {
    id: 'gp1:layout-discipline',
    directive:
      'Follow the layout_guidelines spacing and grid rules when placing elements, and finish generated pages with a tidy/balance pass so they arrive overlap-free.',
  },
  {
    id: 'gp1:multi-region-hub-tier',
    archetype: 'multi-region-hub-spoke',
    directive:
      'Keep inter-region links on the hub tier and group each region’s spokes beneath its hubs; avoid radial hub placement.',
  },
];
