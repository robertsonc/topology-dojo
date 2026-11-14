/**
 * A document is untrusted input: an opened file, an import or a public share
 * link can carry anything. This spec opens one whose ids, labels, colours,
 * numbers and settings are all markup payloads, drives the parts of the editor
 * that draw them, and checks that nothing in the page was built from them.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor } from './helpers';

/** Closes an attribute, opens an element, and reopens an attribute. */
const inert = (tag: string): string =>
  `x" data-pwn="${tag}"><pwn>${tag}</pwn><g y="`;
/** The same breakout with a script that runs if the element is ever created. */
const live = (tag: string): string =>
  `x"><image href="data:image/png;base64,AAAA" onerror="window.__pwned=(window.__pwned||[]).concat('${tag}')"/><g y="`;

function hostileDocument(): unknown {
  return {
    title: inert('title'),
    customNodes: [],
    layers: [
      {
        id: 'L1',
        name: inert('layer-name'),
        color: `red${inert('layer-color')}`,
      },
    ],
    legend: { show: true, title: inert('legend-title') },
    pages: [
      {
        id: 'p1',
        name: inert('page-name'),
        caption: inert('caption'),
        viewBox: `0 0 1050 700${inert('viewBox')}`,
        nodes: [
          {
            id: live('node-id'),
            type: 'router',
            x: 300,
            y: 300,
            label: inert('node-label'),
            sublabel: inert('node-sublabel'),
            tooltip: inert('node-tooltip'),
            color: `#fff${inert('node-color')}`,
            labelColor: inert('node-labelColor'),
            opacity: inert('node-opacity'),
            status: inert('node-status'),
            layer: 'L1',
            meta: { [inert('meta-key')]: inert('meta-value') },
          },
          // Overlaps its neighbour so the Problems panel names both.
          {
            id: inert('node-id-2'),
            type: 'router',
            x: 310,
            y: 305,
            label: 'B',
          },
          { id: 'c', type: 'router', x: 700, y: 300, label: 'Core' },
          {
            id: 't',
            type: 'text',
            x: 500,
            y: 520,
            label: 'note',
            body: inert('body'),
            fill: inert('fill'),
            borderColor: inert('borderColor'),
            fontSize: inert('fontSize'),
            fontWeight: inert('fontWeight'),
          },
        ],
        links: [
          {
            id: live('link-id'),
            type: 'tunnel',
            from: live('node-id'),
            to: 'c',
            label: inert('link-label'),
            fromLabel: inert('fromLabel'),
            toLabel: inert('toLabel'),
            color: inert('link-color'),
            strokeWidth: inert('strokeWidth'),
            flowSpeed: inert('flowSpeed'),
            vlan: inert('vlan'),
          },
          { id: 'l2', type: 'line', from: 'c', to: live('anchor-id') },
        ],
        anchors: [
          { id: live('anchor-id'), x: `450${inert('anchor-x')}`, y: 480 },
        ],
        zones: [
          {
            id: live('zone-id'),
            label: inert('zone-label'),
            color: inert('zone-color'),
            nodes: ['c'],
          },
        ],
        flowPaths: [
          {
            id: live('flow-id'),
            label: inert('flow-label'),
            color: inert('flow-color'),
            width: inert('flow-width'),
            waypoints: [live('node-id'), 'c'],
          },
        ],
        policyMarkers: [
          {
            id: live('marker-id'),
            nodeId: 'c',
            type: 'inspect',
            icon: inert('marker-icon'),
            label: inert('marker-label'),
          },
        ],
      },
    ],
  };
}

/** Nothing in the page was built from the document's strings. */
async function expectNoInjection(page: Page, where: string): Promise<void> {
  const found = await page.evaluate(() => ({
    script: (window as unknown as { __pwned?: string[] }).__pwned ?? null,
    elements: document.querySelectorAll('pwn').length,
    attributes: document.querySelectorAll('[data-pwn]').length,
    handlers: document.querySelectorAll('image[onerror]').length,
  }));
  expect(found, where).toEqual({
    script: null,
    elements: 0,
    attributes: 0,
    handlers: 0,
  });
}

/** A page (user-space) point as a client point. */
async function toClient(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([px, py]) => {
      const svg = document.querySelector<SVGSVGElement>('#overlay')!;
      const p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
}

async function openHostile(page: Page): Promise<void> {
  await page.locator('#fInput').setInputFiles({
    name: 'review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(hostileDocument())),
  });
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(4);
}

test('an opened document cannot inject markup anywhere in the editor', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());
  await bootEditor(page);
  await openHostile(page);
  await expectNoInjection(page, 'after open');

  // The canvas drew it: the hostile id is there as data, on one element.
  const ids = await page
    .locator('#page-canvas [data-tds-node]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-tds-node')));
  expect(ids.filter((id) => id?.includes('onerror'))).toHaveLength(1);

  // Properties for a node, a link, the page.
  const node = await toClient(page, 300, 300);
  await page.mouse.click(node.x, node.y);
  await expectNoInjection(page, 'node selected');
  const link = await toClient(page, 520, 300);
  await page.mouse.click(link.x, link.y);
  await expectNoInjection(page, 'link selected');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await expectNoInjection(page, 'select all');

  // Problems names the overlapping nodes by label or id.
  await page.locator('#problems-toggle').click();
  await expectNoInjection(page, 'problems open');

  // Find lists ids, labels, types and metadata.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('x');
  await expectNoInjection(page, 'find open');
  await page.keyboard.press('Escape');

  // The context menu, then Present (which draws the page standalone).
  await page.mouse.click(node.x, node.y, { button: 'right' });
  await expectNoInjection(page, 'context menu');
  await page.keyboard.press('Escape');
  await page.locator('#tPresent').click();
  await expectNoInjection(page, 'presenting');
  await page.keyboard.press('Escape');

  // The autosaved copy is drawn again on reload.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await page.reload();
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(4);
  await expectNoInjection(page, 'after reload');
});

test('a public share link cannot inject markup', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/api/topology/evil',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(hostileDocument()),
      }),
  );
  await page.goto('/v/evil');
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(4);
  await expectNoInjection(page, 'share link');
});

test('an imported CSV cannot inject markup', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await bootEditor(page);
  const cell = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const csv =
    `[nodes]\nid,label,type\n${cell(live('csv-id'))},${cell(inert('csv-label'))},${cell(inert('csv-type'))}\n` +
    `b,Core,router\n[links]\nfrom,to,label\n${cell(live('csv-id'))},b,${cell(inert('csv-link'))}\n`;
  await page.locator('#fInput').setInputFiles({
    name: 'sites.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(2);
  await expectNoInjection(page, 'csv import');
});
