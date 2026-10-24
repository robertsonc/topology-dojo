/**
 * A minimal, defensive XML reader for interchange imports (`.drawio` today).
 *
 * The Worker and the stdio server have no DOMParser, and the formats we read
 * are plain element/attribute trees, so this parses exactly that: elements,
 * attributes, text and CDATA. It deliberately does NOT process DTDs or
 * custom entities (no `<!DOCTYPE>` expansion, so no billion-laughs or XXE);
 * only the five predefined entities and numeric character references are
 * decoded. Input size and nesting depth are bounded by the caller-visible
 * limits below; anything malformed throws an Error naming the offset.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text / CDATA content. */
  text: string;
}

/** Largest document accepted (characters). */
export const MAX_XML_CHARS = 8 * 1024 * 1024;
/** Deepest element nesting accepted. */
export const MAX_XML_DEPTH = 256;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode the predefined entities and numeric character references. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X'
          ? parseInt(ref.slice(2), 16)
          : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED[ref] ?? m;
  });
}

const NAME_RE = /[A-Za-z_:][\w.:-]*/y;

/** Parse an XML document and return its root element. */
export function parseXml(input: string): XmlElement {
  if (input.length > MAX_XML_CHARS)
    throw new Error(`XML is too large (over ${MAX_XML_CHARS} characters)`);
  let i = 0;
  const n = input.length;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const fail = (msg: string): never => {
    throw new Error(`invalid XML at offset ${i}: ${msg}`);
  };
  const readName = (): string => {
    NAME_RE.lastIndex = i;
    const m = NAME_RE.exec(input);
    if (!m) fail('expected a name');
    i += m![0].length;
    return m![0];
  };
  const skipWs = (): void => {
    while (i < n && /\s/.test(input[i]!)) i++;
  };

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      if (input.slice(i).trim() && !stack.length && root)
        fail('text after the root element');
      if (stack.length)
        stack[stack.length - 1]!.text += decodeEntities(input.slice(i));
      break;
    }
    if (lt > i && stack.length)
      stack[stack.length - 1]!.text += decodeEntities(input.slice(i, lt));
    i = lt;
    if (input.startsWith('<?', i)) {
      const end = input.indexOf('?>', i);
      if (end === -1) fail('unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i);
      if (end === -1) fail('unterminated comment');
      i = end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', i)) {
      const end = input.indexOf(']]>', i);
      if (end === -1) fail('unterminated CDATA');
      if (stack.length)
        stack[stack.length - 1]!.text += input.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (input.startsWith('<!', i))
      fail('DTDs and declarations are not supported');
    if (input.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipWs();
      if (input[i] !== '>') fail('expected >');
      i++;
      const open = stack.pop();
      if (!open || open.name !== name) fail(`unexpected </${name}>`);
      continue;
    }
    // Start tag.
    i++;
    const el: XmlElement = {
      name: readName(),
      attrs: {},
      children: [],
      text: '',
    };
    for (;;) {
      skipWs();
      if (input.startsWith('/>', i)) {
        i += 2;
        attach(el, true);
        break;
      }
      if (input[i] === '>') {
        i++;
        attach(el, false);
        break;
      }
      const key = readName();
      skipWs();
      if (input[i] !== '=') fail(`expected = after ${key}`);
      i++;
      skipWs();
      const q = input[i];
      if (q !== '"' && q !== "'") fail('expected a quoted attribute value');
      const end = input.indexOf(q!, i + 1);
      if (end === -1) fail('unterminated attribute value');
      if (Object.prototype.hasOwnProperty.call(el.attrs, key))
        fail(`duplicate attribute ${key}`);
      el.attrs[key] = decodeEntities(input.slice(i + 1, end));
      i = end + 1;
    }
  }
  if (stack.length) fail(`unclosed <${stack[stack.length - 1]!.name}>`);
  if (!root) fail('no root element');
  return root!;

  function attach(el: XmlElement, selfClosing: boolean): void {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (root) fail('more than one root element');
    else root = el;
    if (!selfClosing) {
      if (stack.length >= MAX_XML_DEPTH) fail('nesting is too deep');
      stack.push(el);
    }
  }
}

/** Direct children with a given element name. */
export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}

/** First descendant (depth-first) with a given element name. */
export function findFirst(
  el: XmlElement,
  name: string,
): XmlElement | undefined {
  for (const c of el.children) {
    if (c.name === name) return c;
    const d = findFirst(c, name);
    if (d) return d;
  }
  return undefined;
}
