import { test, expect, type Page } from '@playwright/test';
import { bootEditor } from './helpers.js';

interface Commit {
  operations: number;
  baseRevision: number;
}

/**
 * A minimal stand-in for the hosted workspace API: enough for hand-off and
 * sync, with the coordinator's 250-operation commit limit enforced the way
 * `worker/document.ts` does (HTTP 400 and its message).
 */
async function mockWorkspaceApi(
  page: Page,
  refuseAll = false,
): Promise<Commit[]> {
  const commits: Commit[] = [];
  let revision = 0;
  let document: unknown = null;
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      const snapshot = () => ({
        id: 'ws_e2e',
        revision,
        document,
        lease: null,
      });
      if (path === '/api/me') return json({ login: 'e2e' });
      if (path === '/api/workspaces' && request.method() === 'POST') {
        document = (request.postDataJSON() as { document: unknown }).document;
        return json(snapshot());
      }
      if (path === '/api/workspaces') return json([]);
      if (path === '/api/workspaces/ws_e2e') return json(snapshot());
      if (path.endsWith('/operations')) {
        const body = request.postDataJSON() as {
          baseRevision: number;
          operations: unknown[];
        };
        commits.push({
          operations: body.operations.length,
          baseRevision: body.baseRevision,
        });
        if (refuseAll)
          return json({ error: 'text exceeds the label limit' }, 400);
        if (body.operations.length > 250)
          return json({ error: 'operation batch exceeds 250 operations' }, 400);
        revision += 1;
        return json({ ok: true, revision, rebased: false, summary: {} });
      }
      if (path.endsWith('/manifest'))
        return json({ id: 'ws_e2e', revision, pages: [], lease: null });
      if (path.endsWith('/changes'))
        return json({ revision, changes: [], hasMore: false });
      if (path.endsWith('/proposals') || path.endsWith('/checkpoints'))
        return json([]);
      return json({ error: 'not found' }, 404);
    },
  );
  return commits;
}

const question = (page: Page, label: string) =>
  page.locator('.sdw-q', {
    has: page.locator(`.sdw-label:text-is("${label}")`),
  });

test('a change over the commit limit syncs as several commits', async ({
  page,
}) => {
  const commits = await mockWorkspaceApi(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await bootEditor(page);

  // A fabric large enough that pasting a copy of it is > 250 operations.
  await page.selectOption('#fTemplate', '__sdwan');
  await question(page, 'Regions')
    .getByRole('button', { name: '3', exact: true })
    .click();
  await question(page, 'WAN links per branch')
    .getByRole('button', { name: '3', exact: true })
    .click();
  await question(page, 'Branch edge')
    .getByRole('button', { name: 'HA pair' })
    .click();
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(page.locator('.sdw-card')).toHaveCount(0);

  await page.locator('#workspaceChip').click();
  await page.locator('#wsHandoff').click();
  await expect(page.locator('#workspaceLabel')).toHaveText('agent · r0');

  await page.keyboard.press('Escape');
  await page.mouse.click(800, 450);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');

  // Every commit is within the limit, each builds on the one before, and
  // together they carry more than one commit's worth.
  await expect
    .poll(() => commits.reduce((sum, c) => sum + c.operations, 0))
    .toBeGreaterThan(250);
  await expect.poll(() => commits.length).toBeGreaterThan(1);
  await expect(page.locator('#workspaceLabel')).toHaveText(
    `agent · r${commits.length}`,
  );
  expect(commits.every((c) => c.operations <= 250)).toBe(true);
  expect(commits.map((c) => c.baseRevision)).toEqual(commits.map((_, i) => i));
});

test('a commit the server refuses stops retrying and shows the reason', async ({
  page,
}) => {
  const commits = await mockWorkspaceApi(page, true);
  page.on('dialog', (dialog) => void dialog.accept());
  await bootEditor(page);
  await page.locator('#workspaceChip').click();
  await page.locator('#wsHandoff').click();
  await expect(page.locator('#workspaceLabel')).toHaveText('agent · r0');

  await page.keyboard.press('Escape');
  await page.mouse.click(800, 450);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');

  // Three attempts (a refusal can be a transient coordinator error), then
  // sync pauses with the server's message instead of an "offline" label.
  await page.locator('#workspaceChip').click();
  await expect(page.locator('#wsBody .ws-error')).toHaveText(
    'text exceeds the label limit',
    { timeout: 20_000 },
  );
  await expect(
    page.locator('#wsBody .ws-row', { hasText: 'Status' }),
  ).toContainText('sync rejected', { timeout: 20_000 });
  expect(commits).toHaveLength(3);
  await page.waitForTimeout(6000); // one retry interval: nothing more is sent
  expect(commits).toHaveLength(3);
});
