/**
 * Opening a public share link parks the local document and keeps the shared
 * copy in its own slot. The next visit to `/` starts the editor on that copy:
 * the whole editor has to come up, not just the canvas.
 */
import { expect, test } from '@playwright/test';
import { bootEditor } from './helpers';

function sharedDocument(): unknown {
  return {
    title: 'Shared fabric',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Shared frame',
        viewBox: '0 0 1050 700',
        nodes: [
          { id: 'a', type: 'router', x: 300, y: 300, label: 'Edge' },
          { id: 'b', type: 'router', x: 700, y: 300, label: 'Core' },
        ],
        links: [{ id: 'l', type: 'line', from: 'a', to: 'b' }],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

test('the editor starts up on / after a share link was opened', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootEditor(page);
  await page.route(
    (url) => url.pathname === '/api/topology/shared1',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sharedDocument()),
      }),
  );
  await page.goto('/v/shared1');
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(2);
  await expect(page.locator('#filmstrip')).toContainText('Shared frame');

  await page.goto('/');
  // The shared copy is drawn, and the palette, inspector and filmstrip are up.
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(2);
  await expect(
    page.locator('.pitem[data-type="router"]').first(),
  ).toBeAttached();
  // The panel draws its tab: a section heading at the top level of the tab
  // panel, not one nested anywhere inside it.
  await expect(
    page
      .locator(
        '#inspector[role="tabpanel"] > details.insp-group > summary.insp-h',
      )
      .first(),
  ).toBeAttached();
  await expect(page.locator('#filmstrip [data-page]')).toHaveCount(1);
  await expect(page.locator('#filmstrip')).toContainText('Shared frame');
  expect(errors).toEqual([]);
});
