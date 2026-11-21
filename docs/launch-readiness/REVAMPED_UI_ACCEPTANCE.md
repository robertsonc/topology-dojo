# Revamped editor UI acceptance

Run this checklist on the staging build that contains the editor shell from
[PR #328](https://github.com/robertsonc/topology-dojo/pull/328) or a later candidate.
Use disposable diagrams and staging accounts. Record the full candidate SHA,
staging origin, deployment run, and test date before starting.

## Browser QA

1. Check out the branch containing this test setup. Run the local regression
   suite with `npm ci`, `npx playwright install chromium`, and
   `npm run test:e2e`.
2. Once the workflow reaches the default branch, dispatch **Staging UI QA**
   in GitHub Actions with the full SHA already deployed to staging. To run the
   same tests from a checkout, replace the placeholder with that SHA.

   ```bash
   E2E_DEPLOYED_URL=https://topology-dojo-staging.robertson-corey.workers.dev \
   E2E_DEPLOYED_SHA='replace-with-full-candidate-sha' \
   npm run test:e2e:deployed
   ```

3. Open the `staging-ui-qa` Actions artifact or run
   `npx playwright show-report playwright-deployed/report` after a local run.
   Attach the run URL or report to the acceptance record. The suite checks
   `/healthz` before and after execution. If the SHA differs, rerun against
   the intended deployment.

The staging suite uses fresh signed-out browser profiles and the real Worker
routes and assets. It uses a deliberately missing public link to reach the
editor without credentials. It checks page independence, label editing,
browser-local autosave, SVG contents, compact drawers, keyboard access to Present,
the sign-in entry point, and recovery when a public link is missing. The suite
uses disposable browser-local edits and exports.

## Participant acceptance

Give participants the task and the [User Guide](../USER_GUIDE.md). Ask them to
share where they hesitated and what they expected to happen. Use the acceptance
checks to score the outcome after they finish. Record the browsers exercised
against the [QA compatibility policy](QA_TEST_PLAN.md#31-browser-and-viewport-policy).

### UI-01 · First author

Sign in with a staging account. Create a topology with two labelled devices
and a link. Add a second page, give it a name, and add a different device to it.
Reload and export the first page as SVG.

The first page retains its two devices and link. The second page retains its
name and independent content. The SVG opens outside the editor and shows the
first page. Record any help used and the participant's confidence from 1 to 5.

### UI-02 · Returning author

Find **Help → What moved**. Use Ctrl/Cmd+K to run **Fit view** and **Present**,
then press Escape. Open **Properties** for a selected node, change its label,
then undo and redo the edit.

The note identifies where menus, tools, pages, and Properties moved. Both
commands run from the command palette, and Escape returns to the editor. Undo
restores the previous label, and redo restores the edit. If a pre-upgrade
browser profile is available, verify that **Got it** keeps the automatic note
dismissed across reload.

### UI-03 · Compact and accessible editor

At 390×844, open the node library, then Properties. Close Properties and use
**Fit view**. On desktop, select a page and enter and exit Present using the
keyboard and a supported screen reader. Repeat the desktop tasks at 200% and
400% browser zoom and check both themes.

Only one drawer opens at a time at phone width. Fit view remains reachable
after closing Properties. The participant can identify the focused control,
select the intended page, and leave Present by keyboard. Record the browser,
viewport, zoom, theme, and assistive technology.

### UI-04 · Public recipient

Publish the disposable topology from **Share**. In a second browser profile,
save a different local draft, sign out, and open the link. Inspect the shared
pages, then choose **Back to my document**. Open the same link in a fresh
signed-out phone-width profile and check that the pages are readable.

The link opens without sign-in. The recipient can navigate the shared pages,
and **Back to my document** restores the second profile's draft. Record the
test share ID and unpublish the link when the session is complete.

Use the [UAT execution record](UAT_PLAN.md#5-execution-method-and-result-format)
for each journey. Record PASS, FAIL, or BLOCKED with the observed outcome, any
help needed, and an export, screenshot, or defect link where applicable. The
[UAT exit criteria](UAT_PLAN.md#102-exit-criteria) govern sign-off.
