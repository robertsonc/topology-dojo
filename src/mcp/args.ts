/**
 * Admitting a tool call's arguments.
 *
 * A tool's input schema lists what it takes; anything else used to be dropped
 * without a word. An agent that wrote `status: "down"` at the top level of
 * `add_node` (it is a node field, and `describe_capabilities` lists it as
 * one), or passed `pageIndex` to a tool that had none, got a success result
 * and a diagram that did not do what it asked.
 *
 * So before a call is validated, every argument the schema does not list is
 * either put where it belongs or refused with a message that says what to do:
 *
 * - `add_node` / `add_link` take per-type fields in `extra`. A field of that
 *   element kind written beside the arguments is moved into `extra`.
 * - A field of the element kind a tool adds, on a tool with no `extra`
 *   (`add_zone`, `add_flow_path`, `add_policy_marker`): refused, pointing at
 *   `update_element`.
 * - Anything else: refused, naming the argument, the nearest real one when
 *   there is one, and what the tool accepts.
 */
import { declaredKinds } from '../pages/typed-fields.js';

/** The part of a tool definition admission needs. */
export interface ArgSpec {
  name: string;
  inputShape: Record<string, unknown>;
}

/** The element kind each add-tool creates (its catalog scope). */
const SCOPE_OF: Readonly<Record<string, string>> = {
  add_node: 'node',
  add_link: 'link',
  add_zone: 'zone',
  add_flow_path: 'flowPath',
  add_policy_marker: 'policyMarker',
};

let catalogFields: Map<string, Set<string>> | null = null;

/** Catalog field names by scope (`node`, `link`, `zone`, …). */
function fieldsOf(scope: string): Set<string> {
  if (!catalogFields) {
    catalogFields = new Map();
    for (const key of declaredKinds().keys()) {
      const dot = key.indexOf('.');
      const s = key.slice(0, dot);
      const set = catalogFields.get(s) ?? new Set<string>();
      set.add(key.slice(dot + 1));
      catalogFields.set(s, set);
    }
  }
  return catalogFields.get(scope) ?? new Set();
}

/** Edit distance, capped: enough to tell a typo from a different word. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = prev[j]!;
      prev[j] = next;
    }
  }
  return prev[b.length]!;
}

/** The accepted argument a wrong one most likely meant, if any. */
function nearest(key: string, accepted: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const sameIgnoringCase = accepted.find((k) => k.toLowerCase() === lower);
  if (sameIgnoringCase) return sameIgnoringCase;
  // A shortened or lengthened form: `page` for `pageIndex`, `nodeIds` for
  // `nodes`.
  if (lower.length >= 3) {
    const stem = accepted.find((k) => {
      const a = k.toLowerCase();
      return a.startsWith(lower) || lower.startsWith(a);
    });
    if (stem) return stem;
  }
  let best: string | undefined;
  let bestD = 3;
  for (const k of accepted) {
    const d = distance(lower, k.toLowerCase());
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

/**
 * `args` with every argument the tool does not list either moved to where it
 * belongs or refused. Returns `args` itself when there is nothing to do.
 * Throws an Error whose message tells the caller what to change.
 */
export function admitArgs(
  tool: ArgSpec,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const accepted = Object.keys(tool.inputShape);
  const unknown = Object.keys(args).filter((k) => !(k in tool.inputShape));
  if (unknown.length === 0) return args;

  const scope = SCOPE_OF[tool.name];
  const fields = scope ? fieldsOf(scope) : new Set<string>();
  const takesExtra = 'extra' in tool.inputShape;
  const moved: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const key of unknown) {
    if (fields.has(key)) {
      if (takesExtra) moved[key] = args[key];
      else
        problems.push(
          `"${key}" is a ${scope} field that ${tool.name} does not take: add the element, then set it with update_element`,
        );
      continue;
    }
    const hint = nearest(key, accepted);
    problems.push(
      hint
        ? `unknown argument "${key}" (did you mean "${hint}"?)`
        : `unknown argument "${key}"`,
    );
  }
  if (problems.length)
    throw new Error(
      `invalid arguments for ${tool.name} — ${problems.join('; ')}. Accepted: ${accepted.join(', ')}.`,
    );

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (!(k in moved)) out[k] = v;
  const given = args.extra;
  // An explicit `extra` entry wins over the same field written beside it.
  out.extra = {
    ...moved,
    ...(given && typeof given === 'object' && !Array.isArray(given)
      ? (given as Record<string, unknown>)
      : {}),
  };
  return out;
}
