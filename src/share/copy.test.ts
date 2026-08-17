import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHARE_PUBLIC_WARNING } from './copy.js';
import { createTools } from '../mcp/tools.js';
import { TopologyStore } from '../mcp/store.js';
import { renderDocumentToSVG } from '../server/render.js';

describe('SHARE_PUBLIC_WARNING', () => {
  it('states that the link is public and unauthenticated', () => {
    expect(SHARE_PUBLIC_WARNING).toMatch(/this link is public/i);
    expect(SHARE_PUBLIC_WARNING).toMatch(/anyone with the URL/i);
    expect(SHARE_PUBLIC_WARNING).toMatch(/without signing in/i);
  });

  it('is included in the share_topology MCP tool description', () => {
    const tools = createTools(new TopologyStore(), {
      renderDocument: renderDocumentToSVG,
      publishTopology: async () => ({
        id: 'x',
        url: 'https://example.com/v/x',
      }),
    });
    const share = tools.find((t) => t.name === 'share_topology');
    expect(share?.description).toContain(SHARE_PUBLIC_WARNING);
  });

  it('is shown on the shared-viewer banner in the editor shell', () => {
    const main = readFileSync(
      fileURLToPath(new URL('../main.ts', import.meta.url)),
      'utf8',
    );
    expect(main).toContain('SHARE_PUBLIC_WARNING');
    expect(main).toContain('sharedBanner');
  });
});
