/**
 * The template parameter dialog, at the level its DOM is built from: the
 * state and markup helpers are pure, so they run under the repo's Node test
 * environment (no DOM — see workspace-panel.test.ts for the convention).
 * The dialog itself is covered in a browser by e2e/template-wizard.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CHOICE_BUTTONS,
  renderTemplateFormHtml,
  templateStatsText,
  templateWizardState,
  usesSlider,
  withTemplateParam,
  type TemplateWizardState,
} from './template-wizard.js';
import { generateTemplate, listTemplates } from '../api/templates.js';

const state = (id: string): TemplateWizardState => templateWizardState(id)!;

/** The `<div class="sdw-q" …>…</div>` block of one parameter. */
function question(html: string, name: string): string {
  const parts = html.split('<div class="sdw-q"').slice(1);
  const found = parts.find((p) => p.startsWith(` data-param="${name}"`));
  if (!found) throw new Error(`no question for ${name}`);
  return found;
}

describe('templateWizardState', () => {
  it('starts every parameter at its default', () => {
    expect(state('spine-leaf').values).toEqual({ spines: 2, leaves: 4 });
    expect(state('firewall-dmz').values).toEqual({
      dmzServers: 2,
      internalFirewall: false,
    });
    expect(state('hub-spoke').template.name).toBe('Hub and spoke');
  });

  it('has nothing to ask for a fixed or unknown template', () => {
    expect(templateWizardState('ztna')).toBeNull();
    expect(templateWizardState('sdwan-branch')).toBeNull();
    expect(templateWizardState('nope')).toBeNull();
  });

  it('opens on the document the template builds with no parameters', () => {
    for (const t of listTemplates().filter((x) => x.params.length)) {
      const viaDialog = generateTemplate(t.id, state(t.id).values);
      const plain = generateTemplate(t.id);
      expect(viaDialog.params).toEqual(plain.params);
      expect(viaDialog.stats).toEqual(plain.stats);
    }
  });
});

describe('withTemplateParam', () => {
  it('takes a value from a control and leaves the rest alone', () => {
    const before = state('spine-leaf');
    const after = withTemplateParam(before, 'leaves', '12');
    expect(after.values).toEqual({ spines: 2, leaves: 12 });
    // A new state: the old one is untouched.
    expect(before.values).toEqual({ spines: 2, leaves: 4 });
    expect(
      withTemplateParam(state('firewall-dmz'), 'internalFirewall', 'true')
        .values,
    ).toEqual({ dmzServers: 2, internalFirewall: true });
  });

  it('keeps numbers whole and inside the bounds', () => {
    const s = state('spine-leaf');
    expect(withTemplateParam(s, 'leaves', '99').values.leaves).toBe(16);
    expect(withTemplateParam(s, 'leaves', '-3').values.leaves).toBe(2);
    expect(withTemplateParam(s, 'leaves', '7.6').values.leaves).toBe(8);
  });

  it('ignores what it cannot read', () => {
    const s = state('firewall-dmz');
    expect(withTemplateParam(s, 'dmzServers', '')).toBe(s);
    expect(withTemplateParam(s, 'dmzServers', 'lots')).toBe(s);
    expect(withTemplateParam(s, 'internalFirewall', 'maybe')).toBe(s);
    expect(withTemplateParam(s, 'noSuchParam', '3')).toBe(s);
  });

  it('only ever holds values the template accepts', () => {
    for (const t of listTemplates().filter((x) => x.params.length)) {
      let s = state(t.id);
      for (const p of t.params)
        for (const raw of ['-1', '0', '1000', '2.5', 'true', 'false', 'x'])
          s = withTemplateParam(s, p.name, raw);
      expect(() => generateTemplate(t.id, s.values)).not.toThrow();
    }
  });
});

describe('renderTemplateFormHtml', () => {
  it('asks one question per parameter, in order, under its label', () => {
    const html = renderTemplateFormHtml(state('three-tier'));
    expect(html.match(/class="sdw-q"/g)).toHaveLength(2);
    expect(html.indexOf('Web servers')).toBeLessThan(
      html.indexOf('App servers'),
    );
    const web = question(html, 'webServers');
    expect(web).toContain(
      '<div class="sdw-label" id="tpw-webServers">Web servers</div>',
    );
    expect(web).toContain(
      'role="group" aria-labelledby="tpw-webServers" aria-describedby="tpw-webServers-hint"',
    );
    // The parameter's one-line description sits under its control.
    expect(web).toContain(
      '<p class="sdw-note tpw-hint" id="tpw-webServers-hint">Web servers behind the firewall.</p>',
    );
  });

  it('offers a button for each value of a short range', () => {
    const html = renderTemplateFormHtml(state('spine-leaf'));
    const spines = question(html, 'spines');
    expect(spines.match(/<button /g)).toHaveLength(4);
    expect(spines).toContain(
      '<button type="button" class="tbtn sdw-opt" data-value="2" aria-pressed="true">2</button>',
    );
    expect(spines.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(spines).not.toContain('type="range"');
  });

  it('moves the pressed button with the value', () => {
    const html = renderTemplateFormHtml(
      withTemplateParam(state('spine-leaf'), 'spines', '4'),
    );
    const spines = question(html, 'spines');
    expect(spines).toContain('data-value="4" aria-pressed="true"');
    expect(spines).toContain('data-value="2" aria-pressed="false"');
  });

  it('uses a labelled slider for a long range', () => {
    const s = withTemplateParam(state('spine-leaf'), 'leaves', '12');
    const leaves = question(renderTemplateFormHtml(s), 'leaves');
    expect(leaves).toContain(
      '<label class="sdw-label" id="tpw-leaves" for="tpw-leaves-input">Leaves</label>',
    );
    expect(leaves).toContain(
      '<input type="range" id="tpw-leaves-input" min="2" max="16" step="1" value="12" aria-describedby="tpw-leaves-hint"/>',
    );
    expect(leaves).toContain('<output for="tpw-leaves-input">12</output>');
    expect(leaves).not.toContain('<button');
  });

  it('asks a yes/no parameter with two buttons', () => {
    const html = renderTemplateFormHtml(state('firewall-dmz'));
    const fw = question(html, 'internalFirewall');
    expect(fw).toContain('data-value="false" aria-pressed="true">No</button>');
    expect(fw).toContain('data-value="true" aria-pressed="false">Yes</button>');
    const on = renderTemplateFormHtml(
      withTemplateParam(state('firewall-dmz'), 'internalFirewall', 'true'),
    );
    expect(question(on, 'internalFirewall')).toContain(
      'data-value="true" aria-pressed="true">Yes</button>',
    );
  });

  it('gives every parameter of every template a control', () => {
    for (const t of listTemplates().filter((x) => x.params.length)) {
      const html = renderTemplateFormHtml(state(t.id));
      for (const p of t.params) {
        const q = question(html, p.name);
        expect(q).toContain(p.label);
        if (usesSlider(p)) expect(q).toContain('type="range"');
        else expect(q).toContain('aria-pressed="true"');
      }
    }
  });

  it('escapes whatever a template puts in a label or description', () => {
    const s: TemplateWizardState = {
      template: {
        id: 'x',
        name: 'X',
        description: '',
        params: [
          {
            name: 'n',
            label: '<b>N</b> & "more"',
            type: 'boolean',
            default: false,
            description: 'a "quoted" <tip>',
          },
        ],
      },
      values: { n: false },
    };
    const html = renderTemplateFormHtml(s);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;N&lt;/b&gt; &amp; &quot;more&quot;');
    expect(html).toContain('>a &quot;quoted&quot; &lt;tip&gt;</p>');
  });
});

describe('usesSlider', () => {
  it('switches to a slider past a handful of values', () => {
    const spec = (min: number, max: number) =>
      ({
        name: 'n',
        label: 'N',
        type: 'integer',
        min,
        max,
        default: min,
        description: '',
      }) as const;
    expect(usesSlider(spec(1, MAX_CHOICE_BUTTONS))).toBe(false);
    expect(usesSlider(spec(1, MAX_CHOICE_BUTTONS + 1))).toBe(true);
    expect(
      usesSlider({
        name: 'b',
        label: 'B',
        type: 'boolean',
        default: true,
        description: '',
      }),
    ).toBe(false);
  });
});

describe('templateStatsText', () => {
  it('counts nodes and links, singular when there is one', () => {
    expect(templateStatsText({ nodes: 16, links: 48 })).toBe(
      '16 nodes · 48 links',
    );
    expect(templateStatsText({ nodes: 1, links: 1 })).toBe('1 node · 1 link');
    expect(templateStatsText({ nodes: 2, links: 0 })).toBe('2 nodes · 0 links');
  });
});
