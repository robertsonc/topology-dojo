/**
 * The surfaces that read the command table: the tooltips that carry a
 * shortcut, the shortcut sheet, and a toolbar control that runs its command
 * through the registry. The tooltips must read as they did when each was
 * written by hand; the sheet lists the table's commands and the gestures.
 */
import { expect, test } from '@playwright/test';
import { bootEditor, clickNode, nodeBox } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

test('the tooltips name their shortcut as before', async ({ page }) => {
  const titles: [selector: string, title: string][] = [
    ['#tUndo', 'Undo (Ctrl/Cmd+Z)'],
    ['#tRedo', 'Redo (Ctrl/Cmd+Shift+Z)'],
    ['#tSelect', 'Select/move tool (V)'],
    ['#tLink', 'Draw link tool (L)'],
    ['#tAnchor', 'Drop anchor tool (A) — free-floating link endpoints'],
    ['#tGrid', 'Toggle grid (R)'],
    ['#tSnap', 'Toggle snap (G)'],
    ['#tCalm', 'Calm canvas — pause animations (C)'],
    ['#tHelp', 'Keyboard shortcuts (?)'],
    ['#tTidy', 'Tidy layout — grid-snap + de-overlap (T)'],
    ['#palette-toggle', 'Hide node library (B)'],
    // The minimap card starts closed.
    ['#minimap-toggle', 'Show minimap (M)'],
    ['#frames-toggle', 'Hide pages (F)'],
    ['#inspector-toggle', 'Hide properties (P)'],
    ['#ccZoomOut', 'Zoom out (-)'],
    ['#ccZoom', 'Fit view (0)'],
    ['#ccZoomIn', 'Zoom in (+)'],
    ['#ccFit', 'Fit to content (0)'],
  ];
  for (const [selector, title] of titles)
    await expect(page.locator(selector), selector).toHaveAttribute(
      'title',
      title,
    );

  // The commands whose toolbar buttons are now menu items name the same
  // shortcut beside the item.
  for (const [menu, command, label, key] of [
    ['view', 'view.fit', 'Fit to content', '0'],
    ['edit', 'edit.delete', 'Delete', 'Del'],
    ['arrange', 'arrange.balance', 'Balance', 'Shift+T'],
  ] as const) {
    await page.locator(`#menubar [data-menu="${menu}"]`).click();
    const item = page.locator(`.menu [data-command="${command}"]`);
    await expect(item.locator('.menu-label')).toHaveText(label);
    await expect(item.locator('.menu-hint')).toHaveText(key);
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toHaveCount(0);
  }

  // A toggle words its tooltip for what a press would do now.
  await page.keyboard.press('m');
  await expect(page.locator('#minimap-toggle')).toHaveAttribute(
    'title',
    'Hide minimap (M)',
  );
  await page.locator('#tCalm').click();
  await expect(page.locator('#tCalm')).toHaveAttribute(
    'title',
    'Resume animations — glow & flow particles (C)',
  );

  // The inspector's rows for one node.
  await clickNode(page, 'fw');
  const arrange = page.locator('#inspector [data-z]');
  await expect(arrange).toHaveCount(4);
  await expect(page.locator('#inspector [data-z="back"]')).toHaveAttribute(
    'title',
    'Send to back (Ctrl/Cmd+[)',
  );
  await expect(page.locator('#inspector [data-z="backward"]')).toHaveAttribute(
    'title',
    'Send backward ([)',
  );
  await expect(page.locator('#inspector [data-z="forward"]')).toHaveAttribute(
    'title',
    'Bring forward (])',
  );
  await expect(page.locator('#inspector [data-z="front"]')).toHaveAttribute(
    'title',
    'Bring to front (Ctrl/Cmd+])',
  );
  // Copy and paste format: in the rows for two or more nodes (one node has
  // them in its header's "more" menu).
  const second = await nodeBox(page, 'ec');
  await page.keyboard.down('Shift');
  await page.mouse.click(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await page.keyboard.up('Shift');
  await expect(page.locator('#i-copyfmt')).toHaveAttribute(
    'title',
    'Copy format (Ctrl/Cmd+Alt+C)',
  );
  await expect(page.locator('#i-pastefmt')).toHaveAttribute(
    'title',
    'Paste format (Ctrl/Cmd+Alt+V)',
  );
});

test('the shortcut sheet lists the commands by group, then the gestures', async ({
  page,
}) => {
  await page.locator('#tHelp').click();
  const card = page.locator('.help-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.help-col h4')).toHaveText([
    'File',
    'Edit',
    'Selection',
    'Arrange',
    'Tools',
    'View',
    'Pages',
    'Help',
    'Mouse and touch',
    'Dialogs and menus',
    'Presentation',
    'Find and the node library',
  ]);
  const rows = await card.locator('.help-row').evaluateAll((els) =>
    els.map(
      (el) =>
        // A row's shortcuts are one key cap each: read them as the one
        // "A · B" string the command table writes.
        `${[...el.querySelectorAll('kbd')].map((k) => k.textContent).join(' · ')} | ${el.querySelector('.help-what')!.textContent}`,
    ),
  );
  for (const row of [
    'Ctrl/Cmd+S | Download as JSON',
    'Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y | Redo',
    'Ctrl/Cmd+Shift+V | Paste in place (same position, any page)',
    'F2 · Enter | Rename the selected node, link or zone',
    'Shift+T | Balance layout',
    'Shift+0 | Zoom to 100%',
    '0 · Shift+1 | Fit to content',
    'H | Hand: drag to pan',
    '? | This shortcut reference',
    'Space / Middle-drag | Pan (hold Space and drag)',
  ])
    expect(rows, row).toContain(row);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});
