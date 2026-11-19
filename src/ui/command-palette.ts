/**
 * The command palette (Ctrl / Cmd + K): a search field over a ranked list of
 * things the user can run or jump to.
 *
 * Two halves:
 *
 * - Pure, DOM-free logic: `normalise` and `rankEntries` (what matches a query
 *   and in which order; `createRanker` is `rankEntries` for a list that is
 *   ranked many times), and the small index, key and geometry helpers the
 *   list uses. Unit-tested under node.
 * - `openCommandPalette`, which builds the dialog, keeps it in step with the
 *   query and tears it down again. It does not know what a command is: the
 *   caller hands it entries, each with its own `run`.
 *
 * Accessibility follows the WAI-ARIA Authoring Practices "Combobox with
 * listbox popup" pattern (list autocomplete, manual selection), shown inside
 * a modal dialog:
 *
 * - Focus stays in the text field the whole time. The active option is
 *   tracked with `aria-activedescendant` and marked `aria-selected`.
 * - Arrow Down / Arrow Up move through the options and wrap. Page Down /
 *   Page Up move by a page and stop at the ends. Enter runs the active
 *   option. Escape closes (through the shared overlay primitive).
 * - Home and End stay with the text field, where they move the caret, as
 *   they do in every other text field. Ctrl + Home and Ctrl + End (Cmd on a
 *   Mac) go to the first and the last option.
 * - Ctrl / Cmd + K closes the palette again, so the key that opens it is a
 *   toggle. The shell's shortcut handler stands down while an overlay is
 *   open, so the palette has to take this key itself.
 * - Enter and Ctrl / Cmd + K act once per press. Held down, their repeats do
 *   nothing: a press that opens the palette (Enter on its button, Ctrl + K)
 *   and lasts a moment too long must not run the first option or close the
 *   palette again. The keys that move the active option do repeat.
 * - A disabled option can be the active one, so a screen reader reads it as
 *   unavailable, but Enter and a click do nothing on it.
 * - A polite live region reports the number of results once typing settles.
 * - Hovering is not a second highlight: moving the pointer over an option
 *   makes it the active option, so there is only ever one, and the keyboard
 *   and the pointer always agree on which it is.
 */

import { isImeKey } from './ime.js';
import { registerOverlay } from './overlay.js';

/** One thing the palette can run or jump to. */
export interface PaletteEntry {
  /** Stable identifier; rendered as `data-id` on the option. */
  id: string;
  /** What the option is called. Rendered as text, never as markup. */
  title: string;
  /** Where it belongs ("Arrange", "Pages"…): a quiet label, also searched. */
  group?: string;
  /** Its keyboard shortcut, shown right-aligned. Not searched. */
  hint?: string;
  /** Other words that should find it. Searched, never shown. */
  keywords?: readonly string[];
  /** Icon markup. TRUSTED: inserted as HTML, so never pass user text. */
  iconHtml?: string;
  /** Listed greyed out and inert. */
  disabled?: boolean;
  /** Called after the palette has closed and focus is back where it was. */
  run: () => void;
}

/** An entry that matched, with how well and where. */
export interface RankedEntry {
  entry: PaletteEntry;
  /** Sum of the per-token match scores (`MATCH_SCORE`); 0 for an empty query. */
  score: number;
  /**
   * Matched character ranges in `entry.title`, for highlighting: offsets into
   * the ORIGINAL title (UTF-16 code units, end exclusive, so
   * `title.slice(start, end)` is the matched text), sorted and never
   * overlapping or touching.
   */
  ranges: readonly [start: number, end: number][];
}

/** Most entries ranked, and most options listed, unless a limit is given. */
export const PALETTE_LIMIT = 50;

/**
 * What one query token scores by where it matched. Stronger first; the
 * values only need to keep that order, since an entry's score is their sum
 * over the query's tokens.
 */
export const MATCH_SCORE = {
  /** The title is the whole query (single-token queries only). */
  exact: 700,
  /** The title starts with the token. */
  titlePrefix: 600,
  /** A word in the title starts with the token. */
  wordPrefix: 500,
  /** The token occurs somewhere else in the title. */
  titleInside: 400,
  /** A keyword starts with the token. */
  keywordPrefix: 300,
  /** The group starts with the token. */
  groupPrefix: 200,
  /** A keyword or the group contains the token. */
  contains: 100,
} as const;

// ── Normalising ────────────────────────────────────────────────────────────

/** Letters Unicode decomposition leaves whole that a search still folds. */
const FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ħ: 'h',
  ı: 'i',
  // A word-final sigma is the same letter as any other sigma.
  ς: 'σ',
};
const FOLD_RE = /[ßæœøđðþłħıς]/g;
/**
 * Accents: the combining marks a search drops, because the letter under one
 * is still that letter to someone typing a query.
 *
 * They are the marks Unicode ties to no one script (the accents of Latin,
 * Greek and Cyrillic), the points of Hebrew and Arabic, which everyday
 * writing leaves out, and the variation selectors, such as the one that
 * makes ™ an emoji.
 *
 * Every other mark is spelling and stays: the vowel signs of the Indic
 * scripts, of Thai and of Lao, and the two voicing marks of kana (が is not
 * か), which Unicode files with the first group and are excepted here.
 */
const ACCENT_RE =
  /(?![\u3099\u309a])(?=\p{M})[\p{Script=Inherited}\p{Script=Hebrew}\p{Script=Arabic}\p{Variation_Selector}]/gu;
/** The marks that were kept, with the letter under them when there is one. */
const KEPT_RE = /\P{M}?\p{M}+/gu;
/**
 * What belongs with the character before it: a combining mark, or one of the
 * two half-width voicing marks of katakana, which are letters to Unicode but
 * combining marks once normalised (ｶﾞ is ガ). Sticky: it tests at `lastIndex`.
 */
const JOINER_RE = /[\p{M}\uff9e\uff9f]/uy;
const SPACE_RE = /\s/;
/** Printable ASCII words with single spaces between them and none around:
 * text whose normal form is just its lower case, character for character. */
const SIMPLE_RE = /^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/;

const foldCache = new Map<string, string>();
/** Enough for every script a document mixes; a guard, not a tuning knob. */
const FOLD_CACHE_MAX = 4096;

const compose = (kept: string): string => kept.normalize('NFC');

/**
 * One unit of text, folded: a character (a whole code point) with the
 * combining marks on it. Lower case, no accents.
 *
 * The marks that stay are put back on their letter, as the one character
 * Unicode has for the two where it has one: が, not か and a voicing mark, or
 * か would find が. Only marks are put back. Hangul stays in the jamo that
 * decomposition leaves it in, so that a syllable still being typed (하) finds
 * the finished one (한).
 */
function foldUnit(unit: string): string {
  const code = unit.charCodeAt(0);
  if (code < 0x80 && unit.length === 1)
    return code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 32) : unit;
  let out = foldCache.get(unit);
  if (out === undefined) {
    out = unit
      .normalize('NFKD')
      .replace(ACCENT_RE, '')
      .replace(KEPT_RE, compose)
      .toLowerCase()
      .replace(FOLD_RE, (c) => FOLDS[c] ?? c);
    if (foldCache.size >= FOLD_CACHE_MAX) foldCache.clear();
    foldCache.set(unit, out);
  }
  return out;
}

/** `JOINER_RE` remembered per UTF-16 code unit: 1 when it is one, 2 when it
 * is not, 0 until asked. */
const joiners = new Uint8Array(0x10000);

/** Whether the character at `i` belongs with the one before it. */
function joinsAt(text: string, i: number): boolean {
  const code = text.charCodeAt(i);
  // No mark is below U+0300, which settles most text at once.
  if (code < 0x300) return false;
  // Half of a surrogate pair does not say which character it is: those are
  // asked every time.
  const half = code >= 0xd800 && code <= 0xdfff;
  let known = half ? 0 : joiners[code]!;
  if (known === 0) {
    JOINER_RE.lastIndex = i;
    known = JOINER_RE.test(text) ? 1 : 2;
    if (!half) joiners[code] = known;
  }
  return known === 1;
}

/** A normalised string, and which stretch of the source each of its
 * characters came from. */
interface Folded {
  text: string;
  /** Per character of `text`: where its source unit starts… */
  starts: number[];
  /** …and ends (exclusive), in UTF-16 code units of the source. */
  ends: number[];
}

/**
 * Normalise `text` one unit at a time, keeping the way back. A unit is a
 * character and the combining marks on it: they are folded together, and
 * whatever the unit becomes maps back to all of it, so a highlight never
 * parts a letter from its marks, dropped or kept.
 *
 * A unit can become several characters (ß → ss, ﬁ → fi), none (an accent
 * with no letter before it) or share one with its neighbours (a run of
 * whitespace → one space), which is why the map is per output character and
 * holds a range.
 */
function fold(text: string): Folded {
  let out = '';
  const starts: number[] = [];
  const ends: number[] = [];
  // A run of whitespace waiting for the next visible character.
  let gap = false;
  let gapStart = 0;
  let gapEnd = 0;
  let i = 0;
  while (i < text.length) {
    const start = i;
    do i += text.codePointAt(i)! > 0xffff ? 2 : 1;
    while (i < text.length && joinsAt(text, i));
    const end = i;
    const folded = foldUnit(
      end - start === 1 ? text[start]! : text.slice(start, end),
    );
    for (const c of folded) {
      if (SPACE_RE.test(c)) {
        if (!gap) {
          gap = true;
          gapStart = start;
        }
        gapEnd = end;
        continue;
      }
      if (gap) {
        gap = false;
        // Whitespace before the first visible character is dropped.
        if (out !== '') {
          out += ' ';
          starts.push(gapStart);
          ends.push(gapEnd);
        }
      }
      out += c;
      for (let k = 0; k < c.length; k++) {
        starts.push(start);
        ends.push(end);
      }
    }
  }
  return { text: out, starts, ends };
}

/**
 * The form text is compared in: lower case, accents stripped, whitespace
 * collapsed to single spaces and trimmed.
 *
 * An accent is a mark on a letter that someone searching leaves off: those
 * of Latin, Greek and Cyrillic (é → e, ά → α, ё → е and, by the same rule,
 * й → и), the points of Hebrew and Arabic, and variation selectors. A mark
 * that spells is kept: the vowel signs of the Indic scripts and of Thai, and
 * the voicing marks of kana, so が is not か and हिंदी is not हद. Text that
 * differs only in how Unicode encodes it (composed or decomposed, marks in
 * either order) has one normal form.
 *
 * Beyond accents this folds compatibility forms (full-width letters,
 * half-width katakana, ligatures such as ﬁ) and a few letters that have no
 * accent to strip but are typed as plain ones: ß → ss, æ → ae, œ → oe,
 * ø → o, đ / ð → d, þ → th, ł → l, ħ → h, ı → i. The result can be longer or
 * shorter than the input.
 */
export function normalise(text: string): string {
  return SIMPLE_RE.test(text) ? text.toLowerCase() : fold(text).text;
}

// ── Ranking ────────────────────────────────────────────────────────────────

type Span = [start: number, end: number];

/** Sort ranges and join the ones that overlap or touch. */
export function mergeRanges(
  ranges: readonly (readonly [number, number])[],
): [start: number, end: number][] {
  const sorted = ranges
    .filter(([start, end]) => end > start)
    .map(([start, end]): Span => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push(span);
  }
  return out;
}

/**
 * Ranges found in a title's normalised form, as ranges of the title itself.
 * A range grows to whole source units: a match on half of the "ss" that ß
 * became covers the ß, and a matched letter takes its combining marks with
 * it, whichever part of what it became was matched.
 */
function titleRanges(title: string, spans: readonly Span[]): Span[] {
  if (spans.length === 0) return [];
  if (SIMPLE_RE.test(title)) return mergeRanges(spans);
  const { starts, ends } = fold(title);
  return mergeRanges(
    spans.map(([start, end]): Span => [starts[start]!, ends[end - 1]!]),
  );
}

/** Whether a word starts after this character: space, hyphen, slash, colon,
 * dot or a parenthesis. */
function isWordBreak(code: number): boolean {
  return (
    code === 0x20 || // space
    code === 0x2d || // -
    code === 0x2f || // /
    code === 0x3a || // :
    code === 0x2e || // .
    code === 0x28 || // (
    code === 0x29 // )
  );
}

/** Set by `matchTitle`: where in the title the token matched. */
let matchAt = 0;

/**
 * The score of `token` against a normalised title, 0 when it is not there.
 * The strongest reading wins: a token that is both inside one word and at
 * the start of a later one counts as the word start, and that occurrence is
 * the one highlighted.
 */
function matchTitle(title: string, token: string, whole: boolean): number {
  const first = title.indexOf(token);
  if (first < 0) return 0;
  matchAt = first;
  if (first === 0)
    return whole && title.length === token.length
      ? MATCH_SCORE.exact
      : MATCH_SCORE.titlePrefix;
  for (let at = first; at >= 0; at = title.indexOf(token, at + 1))
    if (isWordBreak(title.charCodeAt(at - 1))) {
      matchAt = at;
      return MATCH_SCORE.wordPrefix;
    }
  return MATCH_SCORE.titleInside;
}

/** The score of `token` against the keywords and the group, 0 for neither. */
function matchRest(
  keywords: readonly string[],
  group: string,
  token: string,
): number {
  let contained = false;
  for (const keyword of keywords) {
    const at = keyword.indexOf(token);
    if (at === 0) return MATCH_SCORE.keywordPrefix;
    if (at > 0) contained = true;
  }
  const at = group.indexOf(token);
  if (at === 0) return MATCH_SCORE.groupPrefix;
  return contained || at > 0 ? MATCH_SCORE.contains : 0;
}

const NO_KEYWORDS: readonly string[] = [];

/** What a query is compared with for one entry, in normal form. */
interface Prepared {
  title: string;
  /** Null until a token is not in the title: most entries never need them. */
  keywords: readonly string[] | null;
  group: string;
}

/** `rankEntries` for one list: see `createRanker`. */
export type PaletteRanker = (query: string, limit?: number) => RankedEntry[];

/**
 * A ranker for one list of entries: `rankEntries` with the list fixed, for
 * ranking the same entries again and again, as the palette does on every
 * keystroke.
 *
 * The normal form of what a query is compared with (each title, and the
 * keywords and group of an entry whose title did not have a token) is worked
 * out the first time it is needed and kept, so the rankings after the first
 * cost the matching alone. The list is copied when the ranker is made and
 * each entry is read as it is when first needed: make a new ranker when the
 * list, or an entry in it, changes.
 */
export function createRanker(entries: readonly PaletteEntry[]): PaletteRanker {
  const list = entries.slice();
  const prepared: Prepared[] = [];
  return (query, limit = PALETTE_LIMIT) => {
    const max = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));
    const q = normalise(query);
    if (q === '')
      return list
        .slice(0, max)
        .map((entry) => ({ entry, score: 0, ranges: [] }));
    const tokens = q.split(' ');
    const whole = tokens.length === 1;

    const hits: {
      entry: PaletteEntry;
      index: number;
      score: number;
      length: number;
      spans: Span[];
    }[] = [];
    for (let index = 0; index < list.length; index++) {
      const entry = list[index]!;
      const fields = (prepared[index] ??= {
        title: normalise(entry.title),
        keywords: null,
        group: '',
      });
      let score = 0;
      const spans: Span[] = [];
      for (const token of tokens) {
        let s = matchTitle(fields.title, token, whole);
        if (s > 0) spans.push([matchAt, matchAt + token.length]);
        else {
          if (fields.keywords === null) {
            const group = entry.group;
            fields.keywords = entry.keywords?.map(normalise) ?? NO_KEYWORDS;
            fields.group = group ? normalise(group) : '';
          }
          s = matchRest(fields.keywords, fields.group, token);
        }
        if (s === 0) {
          score = 0;
          break;
        }
        score += s;
      }
      if (score > 0)
        hits.push({ entry, index, score, length: fields.title.length, spans });
    }
    hits.sort(
      (a, b) => b.score - a.score || a.length - b.length || a.index - b.index,
    );
    return hits.slice(0, max).map((hit) => ({
      entry: hit.entry,
      score: hit.score,
      ranges: titleRanges(hit.entry.title, hit.spans),
    }));
  };
}

/**
 * The entries that match `query`, best first, at most `limit`
 * (`PALETTE_LIMIT` by default).
 *
 * The query is split at whitespace into tokens, and EVERY token has to match
 * the entry somewhere: in its title, its group or one of its keywords (the
 * hint is not searched). Matching ignores case and diacritics (`normalise`).
 * Each token scores by its strongest match (`MATCH_SCORE`), the entry scores
 * the sum, and the order is: higher score, then shorter title (in normalised
 * characters), then the order the entries were given in. That makes the
 * result deterministic: the same input always gives the same order.
 *
 * An empty query returns the entries as given. Disabled entries are ranked
 * like any other; showing them inert is the list's job.
 *
 * Every call normalises the entries afresh. To rank one list many times,
 * use `createRanker`.
 */
export function rankEntries(
  query: string,
  entries: readonly PaletteEntry[],
  limit: number = PALETTE_LIMIT,
): RankedEntry[] {
  return createRanker(entries)(query, limit);
}

// ── List helpers ───────────────────────────────────────────────────────────

/** A title cut into plain and matched pieces, in order, for rendering. */
export function titleSegments(
  title: string,
  ranges: readonly (readonly [number, number])[],
): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [from, to] of mergeRanges(ranges)) {
    const start = Math.max(at, Math.min(from, title.length));
    const end = Math.min(to, title.length);
    if (end <= start) continue;
    if (start > at) out.push({ text: title.slice(at, start), match: false });
    out.push({ text: title.slice(start, end), match: true });
    at = end;
  }
  if (at < title.length) out.push({ text: title.slice(at), match: false });
  return out;
}

/** A way the active option moves. */
export type PaletteMove =
  | 'next'
  | 'previous'
  | 'first'
  | 'last'
  | 'pageDown'
  | 'pageUp';

/**
 * The index of the active option after a move, -1 when there are no options.
 * `next` and `previous` wrap around; the page moves stop at the ends.
 * Disabled options are not skipped: they can be active, just not run.
 */
export function moveActive(
  current: number,
  count: number,
  move: PaletteMove,
  page = 1,
): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const step = Math.max(1, Math.floor(page));
  const at = Math.min(Math.max(current, -1), last);
  switch (move) {
    case 'next':
      return at >= last ? 0 : at + 1;
    case 'previous':
      return at <= 0 ? last : at - 1;
    case 'first':
      return 0;
    case 'last':
      return last;
    case 'pageDown':
      return Math.min(last, Math.max(at, 0) + step);
    case 'pageUp':
      return Math.max(0, at - step);
  }
}

/**
 * The option that is active after the list changes: the first enabled one.
 * When every option is disabled it is the first, so there is still something
 * for a screen reader to read; -1 when the list is empty.
 */
export function firstEnabledIndex(
  results: readonly { entry: { disabled?: boolean } }[],
): number {
  const i = results.findIndex((r) => !r.entry.disabled);
  return i >= 0 ? i : results.length > 0 ? 0 : -1;
}

/** The part of a KeyboardEvent the palette reads. */
export interface PaletteKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Whether the key is being held down: an auto-repeat of an earlier press. */
  repeat?: boolean;
}

/**
 * What a key press does in the palette. `none` is a key the palette keeps to
 * itself and does nothing with: Enter or Ctrl / Cmd + K held down.
 */
export type PaletteAction = PaletteMove | 'run' | 'toggle' | 'none';

/**
 * What a key does, or null when it is the text field's own (typing, moving
 * the caret, selecting, plain Home and End). Escape and Tab are not here:
 * the overlay primitive owns them.
 *
 * Running and toggling happen once per press, so a held key's repeats are
 * `none`: otherwise the press that opened the palette would, held a moment
 * too long, run its first option (Enter on the button that opens it) or
 * close it again (Ctrl / Cmd + K). Moving does repeat.
 */
export function paletteKeyAction(e: PaletteKey): PaletteAction | null {
  const command = e.ctrlKey === true || e.metaKey === true;
  if (e.altKey) return null;
  if (command) {
    if (e.shiftKey) return null;
    if (e.key === 'Home') return 'first';
    if (e.key === 'End') return 'last';
    if (e.key === 'k' || e.key === 'K') return e.repeat ? 'none' : 'toggle';
    return null;
  }
  if (e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'PageDown':
      return 'pageDown';
    case 'PageUp':
      return 'pageUp';
    case 'Enter':
      return e.repeat ? 'none' : 'run';
    default:
      return null;
  }
}

/** How many options a Page Down / Page Up moves by: the ones that fit. */
export function pageSize(viewHeight: number, rowHeight: number): number {
  if (!(rowHeight > 0) || !(viewHeight > 0)) return 1;
  return Math.max(1, Math.floor(viewHeight / rowHeight));
}

/**
 * The scroll offset that brings a row fully into a scrolling list, moving as
 * little as possible: unchanged when the row is already inside. `pad` is the
 * room to leave between the row and the edge it is brought to. All values
 * are in the list's content coordinates.
 */
export function scrollTopToReveal(
  row: { top: number; height: number },
  view: { top: number; height: number },
  pad = 0,
): number {
  if (row.top - pad < view.top) return Math.max(0, row.top - pad);
  const bottom = row.top + row.height + pad;
  if (bottom > view.top + view.height) return bottom - view.height;
  return view.top;
}

/** What the live region says once typing settles. `more` is whether the
 * list was cut off at the limit. */
export function resultCountText(count: number, more = false): string {
  if (count <= 0) return 'No results';
  if (more) return `First ${count} results shown`;
  return count === 1 ? '1 result' : `${count} results`;
}

/** An option's accessible name: its title, then its group and shortcut. */
export function optionLabel(
  entry: Pick<PaletteEntry, 'title' | 'group' | 'hint'>,
): string {
  return [entry.title, entry.group, entry.hint].filter(Boolean).join(', ');
}

// ── The dialog ─────────────────────────────────────────────────────────────

export interface PaletteOptions {
  /** What to list. Called once, when the palette opens. */
  entries: () => PaletteEntry[];
  /** Placeholder of the search field. */
  placeholder?: string;
  /** Shown instead of the list when nothing matches. */
  emptyText?: string;
  /** Accessible name of the dialog. Default "Command palette". */
  label?: string;
  /** Accessible name of the search field. Default "Search commands". */
  inputLabel?: string;
  /** Called once the palette has closed, however it closed, after focus has
   * gone back and before a chosen entry's `run`. */
  onClose?: () => void;
}

export interface PaletteHandle {
  /** The outermost element: the scrim. The dialog is its `.cmdk` child. */
  readonly element: HTMLElement;
  isOpen(): boolean;
  /** Close without running anything. Safe to call twice. */
  close(): void;
}

const DEFAULT_LABEL = 'Command palette';
const DEFAULT_INPUT_LABEL = 'Search commands';
const DEFAULT_PLACEHOLDER = 'Type a command, node type or name…';
const DEFAULT_EMPTY_TEXT = 'No results. Try a command, a node type or a name.';
/** How long after the last keystroke the result count is announced. */
const ANNOUNCE_DELAY_MS = 400;

const SEARCH_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'focusable="false"><circle cx="7" cy="7" r="4.25"/>' +
  '<path d="M10.25 10.25 13.5 13.5"/></svg>';

/** The open palette, if there is one: there is only ever one. */
let current: { handle: PaletteHandle; input: HTMLInputElement } | null = null;
/** Makes the ids of each palette's list and options unique in the page. */
let serial = 0;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Readonly<Record<string, string>> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  return node;
}

/**
 * Open the command palette, or, when one is already open, focus its field
 * and return its handle.
 *
 * Choosing an entry (Enter, or a click) closes the palette, puts focus back
 * where it was, and only then calls the entry's `run`. An error thrown by
 * `run` is not caught: the palette is already gone and the error is the
 * caller's.
 */
export function openCommandPalette(options: PaletteOptions): PaletteHandle {
  if (current) {
    if (current.handle.element.isConnected) {
      current.input.focus();
      return current.handle;
    }
    // Removed from the page behind its back: finish closing it.
    current.handle.close();
  }

  const entries = options.entries();
  // Kept for as long as the palette is open: a keystroke re-ranks the same
  // entries, and should not normalise every one of them again.
  const rank = createRanker(entries);
  const hasIcons = entries.some((entry) => entry.iconHtml);
  const limit = PALETTE_LIMIT;
  const uid = `cmdk-${++serial}`;
  const listId = `${uid}-list`;

  const scrim = make('div', 'cmdk-scrim');
  const dialog = make('div', 'cmdk', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label ?? DEFAULT_LABEL,
  });
  const field = make('div', 'cmdk-field');
  const glass = make('span', 'cmdk-glass', { 'aria-hidden': 'true' });
  glass.innerHTML = SEARCH_ICON;
  const input = make('input', 'cmdk-input', {
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': options.inputLabel ?? DEFAULT_INPUT_LABEL,
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER,
  });
  const list = make('div', 'cmdk-list scroll-slim', {
    role: 'listbox',
    id: listId,
    'aria-label': 'Results',
  });
  const empty = make('div', 'cmdk-empty');
  empty.textContent = options.emptyText ?? DEFAULT_EMPTY_TEXT;
  empty.hidden = true;
  const status = make('div', 'cmdk-status visually-hidden', {
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  field.append(glass, input);
  dialog.append(field, list, empty, status);
  scrim.append(dialog);

  let results: RankedEntry[] = [];
  /** Whether more entries matched than are listed. */
  let more = false;
  let active = -1;
  let shownQuery: string | null = null;
  let announceTimer = 0;
  let closed = false;
  let release: () => void = () => {};
  /** Removes every listener below in one go. */
  const listeners = new AbortController();
  const signal = listeners.signal;

  const optionAt = (index: number): HTMLElement | null =>
    (list.children[index] as HTMLElement | undefined) ?? null;

  /** Bring an option fully into the list's viewport (and nothing else: the
   * page behind never scrolls). */
  const reveal = (item: HTMLElement): void => {
    const box = list.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    const top = row.top - box.top - list.clientTop + list.scrollTop;
    const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
    list.scrollTop = scrollTopToReveal(
      { top, height: row.height },
      { top: list.scrollTop, height: list.clientHeight },
      pad,
    );
  };

  const setActive = (index: number, scroll: boolean): void => {
    optionAt(active)?.setAttribute('aria-selected', 'false');
    const item = optionAt(index);
    active = item ? index : -1;
    if (!item) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    item.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', item.id);
    if (scroll) reveal(item);
  };

  const renderOption = (result: RankedEntry, index: number): HTMLElement => {
    const { entry } = result;
    const item = make('div', 'cmdk-item', {
      role: 'option',
      id: `${uid}-opt-${index}`,
      'aria-selected': 'false',
      'aria-label': optionLabel(entry),
      'data-id': entry.id,
    });
    if (entry.disabled) item.setAttribute('aria-disabled', 'true');
    if (hasIcons) {
      const icon = make('span', 'cmdk-icon', { 'aria-hidden': 'true' });
      if (entry.iconHtml) icon.innerHTML = entry.iconHtml;
      item.append(icon);
    }
    const main = make('span', 'cmdk-main');
    const title = make('span', 'cmdk-title');
    // Text nodes only: a title is user text (a node label, a page name).
    for (const segment of titleSegments(entry.title, result.ranges)) {
      if (segment.match) {
        const mark = document.createElement('mark');
        mark.textContent = segment.text;
        title.append(mark);
      } else title.append(document.createTextNode(segment.text));
    }
    main.append(title);
    if (entry.group) {
      const group = make('span', 'cmdk-group');
      group.textContent = entry.group;
      main.append(group);
    }
    item.append(main);
    if (entry.hint) {
      const hint = make('kbd', 'cmdk-hint');
      hint.textContent = entry.hint;
      item.append(hint);
    }
    return item;
  };

  /** Rank for the current query and redraw the list. */
  const refresh = (): void => {
    shownQuery = input.value;
    // One past the limit, to know whether the list is cut off.
    const ranked = rank(input.value, limit + 1);
    more = ranked.length > limit;
    results = more ? ranked.slice(0, limit) : ranked;
    active = -1;
    list.replaceChildren(...results.map(renderOption));
    const any = results.length > 0;
    list.hidden = !any;
    empty.hidden = any;
    input.setAttribute('aria-expanded', String(any));
    list.scrollTop = 0;
    setActive(firstEnabledIndex(results), true);
  };

  /** Say how many results there are, once typing has settled. Emptied
   * first, so the same count is announced again after a new query. */
  const announceSoon = (): void => {
    window.clearTimeout(announceTimer);
    status.textContent = '';
    announceTimer = window.setTimeout(() => {
      status.textContent = resultCountText(results.length, more);
    }, ANNOUNCE_DELAY_MS);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearTimeout(announceTimer);
    listeners.abort();
    if (current?.handle === handle) current = null;
    scrim.remove();
    release();
    options.onClose?.();
  };

  const run = (index: number): void => {
    const entry = results[index]?.entry;
    if (!entry || entry.disabled) return;
    close();
    entry.run();
  };

  const optionIndex = (target: EventTarget | null): number => {
    const item =
      target instanceof Element ? target.closest('.cmdk-item') : null;
    return item ? Array.prototype.indexOf.call(list.children, item) : -1;
  };

  // Typing re-ranks. `input` also fires while an IME composition is open, so
  // the list follows the word as it is built; `compositionend` covers the
  // browsers that commit a candidate without a final `input`.
  const onQuery = (): void => {
    if (input.value === shownQuery) return;
    refresh();
    announceSoon();
  };
  input.addEventListener('input', onQuery, { signal });
  input.addEventListener('compositionend', onQuery, { signal });

  scrim.addEventListener(
    'keydown',
    (e) => {
      // Enter that confirms an IME candidate, or an arrow that picks one,
      // belongs to the input method.
      if (isImeKey(e)) return;
      const action = paletteKeyAction(e);
      if (action === null) return;
      // The palette's own key: it must not also reach a shortcut handler,
      // least of all after it has closed the palette.
      e.preventDefault();
      e.stopPropagation();
      if (action === 'none') return;
      if (action === 'toggle') close();
      else if (action === 'run') run(active);
      else {
        const first = optionAt(0);
        const page = pageSize(list.clientHeight, first?.offsetHeight ?? 0);
        setActive(moveActive(active, results.length, action, page), true);
      }
    },
    { signal },
  );

  // A press anywhere but in the field keeps focus (and the caret) there.
  scrim.addEventListener(
    'mousedown',
    (e) => {
      if (e.target !== input) e.preventDefault();
    },
    { signal },
  );

  // A click on the scrim closes, but only one that also began there: a text
  // selection dragged out of the field ends on the scrim too.
  let pressedOnScrim = false;
  scrim.addEventListener(
    'pointerdown',
    (e) => {
      pressedOnScrim = e.target === scrim;
    },
    { signal },
  );
  scrim.addEventListener(
    'click',
    (e) => {
      if (e.target === scrim) {
        if (pressedOnScrim) close();
        return;
      }
      const index = optionIndex(e.target);
      if (index < 0) return;
      if (index !== active) setActive(index, false);
      run(index);
    },
    { signal },
  );

  // The pointer makes an option active only by MOVING onto it. A list that
  // scrolls under a resting pointer puts a new row beneath it, which must
  // not take the active option away from the keyboard. That rules out the
  // enter / over events, which fire for it; and since some browsers report
  // it as a movement too, a move counts only when the pointer is somewhere
  // it was not.
  let pointer: { x: number; y: number } | null = null;
  scrim.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      const moved =
        pointer !== null &&
        (pointer.x !== e.clientX || pointer.y !== e.clientY);
      pointer = { x: e.clientX, y: e.clientY };
      if (!moved) return;
      const index = optionIndex(e.target);
      if (index >= 0 && index !== active) setActive(index, false);
    },
    { signal },
  );

  const handle: PaletteHandle = {
    element: scrim,
    isOpen: () => !closed,
    close,
  };

  // Ranked before anything is shown: entries that cannot be ranked throw
  // here, to the caller, and leave nothing behind.
  refresh();
  document.body.append(scrim);
  current = { handle, input };
  // Escape closes, Tab stays inside, focus returns to the invoker, and the
  // shell's shortcut handler stands down: all from the overlay primitive.
  release = registerOverlay(scrim, { close, initialFocus: input });
  // Now that there is a layout to measure (the first enabled option can be
  // below the fold when the list opens on a run of disabled ones).
  const first = optionAt(active);
  if (first) reveal(first);
  return handle;
}
