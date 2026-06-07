import { describe, it, expect } from 'vitest';
import { buildTemplate, listTemplates } from './templates.js';
import { validateDocument } from './validate.js';
import { analyzeLayout } from './layout.js';

describe('starter templates', () => {
  it('lists templates with id + name + description', () => {
    const ts = listTemplates();
    expect(ts.length).toBeGreaterThanOrEqual(5);
    for (const t of ts) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });

  it('every template builds valid and overlap-free', () => {
    for (const { id } of listTemplates()) {
      const doc = buildTemplate(id);
      const errors = validateDocument(doc).filter((p) => p.level === 'error');
      expect(errors, `${id} validation`).toEqual([]);
      expect(analyzeLayout(doc), `${id} layout`).toEqual([]);
      expect(doc.pages[0]!.nodes.length).toBeGreaterThan(1);
    }
  });

  it('builds independent copies (no shared mutable state)', () => {
    const a = buildTemplate('three-tier');
    a.pages[0]!.nodes[0]!.x = 9999;
    const b = buildTemplate('three-tier');
    expect(b.pages[0]!.nodes[0]!.x).not.toBe(9999);
  });

  it('throws on an unknown template id', () => {
    expect(() => buildTemplate('nope')).toThrow(/unknown template/);
  });
});
