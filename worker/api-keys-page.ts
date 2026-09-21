/**
 * The `/keys` management page (proposal 0005): a self-contained, server-
 * rendered HTML page plus its one script (`/keys.js`), kept out of the SPA
 * bundle so the editor's visual baselines and bundle are untouched. The page
 * only talks to `/api/keys` (same origin, cookie auth) — inline handlers are
 * not used because the Worker's CSP is `script-src 'self'`.
 *
 * Minting happens here and only here: a key can never mint another key.
 */
import type { SessionUser } from '../src/server/session.js';
import {
  API_KEY_EXPIRY_DAYS,
  MAX_API_KEYS_PER_USER,
  MAX_API_KEY_LABEL,
} from '../src/server/api-key.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
};

export function apiKeysPage(user: SessionUser, enabled: boolean): Response {
  const login = esc(user.login);
  const expiryOptions = API_KEY_EXPIRY_DAYS.map(
    (d) => `<option value="${d}">${d} days</option>`,
  ).join('');
  const disabledNotice = enabled
    ? ''
    : `<p class="notice warn">API keys are disabled on this deployment
      (<code>API_KEYS_ENABLED</code> is not <code>"true"</code>). Existing keys
      are rejected and none can be created until an operator activates the
      feature.</p>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API keys · Topology Dojo</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#2a2f3a;
          --fg:#e6e8ee; --muted:#9aa3b2; --accent:#4cc38a; --warn:#f5b84b; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: var(--bg); color: var(--fg); }
  header { display:flex; align-items:center; gap:16px; padding:14px 24px; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; flex:1; }
  header a { color: var(--muted); text-decoration:none; }
  header a:hover { color: var(--fg); }
  main { max-width: 900px; margin: 0 auto; padding: 24px; }
  section { background: var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px; margin-bottom:20px; }
  h2 { margin:0 0 8px; font-size:16px; }
  p { margin: 6px 0; color: var(--muted); }
  code, pre { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background:#0b0d11; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; }
  label { display:block; margin:10px 0 4px; color: var(--fg); }
  input[type=text], select { width:100%; padding:8px 10px; border-radius:6px; border:1px solid var(--line); background:#0b0d11; color:var(--fg); }
  .scopes label { display:flex; gap:10px; align-items:flex-start; margin:8px 0; }
  .scopes input { margin-top:5px; }
  .scopes small { display:block; color: var(--muted); }
  button { padding:8px 14px; border-radius:6px; border:1px solid var(--line); background:#222734; color:var(--fg); cursor:pointer; }
  button.primary { background: var(--accent); color:#04130b; border-color: transparent; font-weight:600; }
  button.danger { color: var(--bad); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .row { display:flex; gap:10px; align-items:center; margin-top:14px; }
  .notice { padding:10px 12px; border-radius:8px; border:1px solid var(--line); }
  .notice.warn { border-color: var(--warn); color: var(--warn); }
  .notice.bad { border-color: var(--bad); color: var(--bad); }
  .notice.ok { border-color: var(--accent); color: var(--accent); }
  #reveal { display:none; }
  #reveal.show { display:block; }
  .token { display:flex; gap:8px; }
  .token input { flex:1; font-family: ui-monospace, monospace; }
  table { width:100%; border-collapse: collapse; margin-top:10px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px; }
  th { color: var(--muted); font-weight:500; }
  td.mono { font-family: ui-monospace, monospace; font-size:13px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; background:#222734; margin:0 4px 4px 0; font-size:12px; }
  .empty { color: var(--muted); padding: 10px 0; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<header>
  <h1>API keys</h1>
  <span>Signed in as <b>@${login}</b></span>
  <a href="/">← Editor</a>
  <a href="/logout">Sign out</a>
</header>
<main>
  ${disabledNotice}
  <section>
    <h2>Create a key</h2>
    <p>A key lets an unattended agent (a NetClaw instance, a script, a CI job)
    use the hosted MCP endpoint <b>as you</b> — same drafts, same workspaces,
    same rate limits — without the browser sign-in step. Send it as
    <code>Authorization: Bearer &lt;key&gt;</code> on <code>/mcp</code>.
    The full key is shown <b>once</b>, at creation. You can hold up to
    ${MAX_API_KEYS_PER_USER} keys.</p>
    <form id="create" ${enabled ? '' : 'hidden'}>
      <label for="label">Label</label>
      <input type="text" id="label" name="label" maxlength="${MAX_API_KEY_LABEL}" placeholder="e.g. netclaw-lab-border" required>
      <div class="scopes">
        <label>Scopes <small>Every key can author, validate, lay out, and render private drafts. Add only what the agent needs.</small></label>
        <label><input type="checkbox" name="scope" value="share"> <span>share <small>publish public 30-day links, list and revoke them (<code>share_topology</code>, <code>list_shares</code>, <code>unpublish_topology</code>)</small></span></label>
        <label><input type="checkbox" name="scope" value="workspace"> <span>workspace <small>read shared workspaces and submit proposals (the workspace tool group)</small></span></label>
        <label><input type="checkbox" name="scope" value="live-data"> <span>live-data <small>fabric inventory and flows, when this deployment has a provider configured and you are allowed</small></span></label>
      </div>
      <label for="expiry">Expires</label>
      <select id="expiry" name="expiresInDays">
        <option value="">Never (revoke manually)</option>
        ${expiryOptions}
      </select>
      <div class="row">
        <button type="submit" class="primary" id="createBtn">Create key</button>
        <span id="createStatus" class="notice bad" hidden></span>
      </div>
    </form>
    <div id="reveal">
      <p class="notice ok">Copy this key now. It will not be shown again.</p>
      <div class="token">
        <input type="text" id="token" readonly aria-label="New API key">
        <button type="button" id="copyBtn">Copy</button>
      </div>
      <p>MCP client configuration (NetClaw / any client that sends a bearer header):</p>
      <pre id="snippet"></pre>
    </div>
  </section>
  <section>
    <h2>Your keys</h2>
    <p>Revoking takes effect within about a minute everywhere. Keys show only
    their prefix; the secret half is never stored.</p>
    <div id="list"><div class="empty">Loading…</div></div>
  </section>
</main>
<script src="/keys.js"></script>
</body>
</html>`;
  return new Response(html, { headers: PAGE_HEADERS });
}

const SCRIPT = String.raw`(() => {
  const $ = (id) => document.getElementById(id);
  const list = $('list');
  const form = $('create');
  const status = $('createStatus');
  const reveal = $('reveal');

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const showStatus = (msg, kind) => {
    status.textContent = msg;
    status.className = 'notice ' + (kind || 'bad');
    status.hidden = !msg;
  };
  const errorText = (code) =>
    ({
      invalid_label: 'Enter a label (up to 64 characters).',
      invalid_scopes: 'Unknown scope requested.',
      invalid_expiry: 'Pick one of the offered expiry values.',
      too_many_keys: 'Key limit reached — revoke one first.',
      api_keys_disabled: 'API keys are disabled on this deployment.',
      'authentication required': 'Your session expired — sign in again.',
    })[code] || ('Request failed: ' + code);

  async function api(path, init) {
    const res = await fetch(path, {
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      ...init,
    });
    let body = {};
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  function render(keys) {
    list.replaceChildren();
    if (!keys.length) {
      list.append(el('div', { class: 'empty' }, 'No keys yet.'));
      return;
    }
    const table = el('table');
    const head = el('tr');
    for (const h of ['Label', 'Key', 'Scopes', 'Created', 'Last used', 'Expires', ''])
      head.append(el('th', {}, h));
    table.append(head);
    for (const k of keys) {
      const tr = el('tr');
      tr.append(el('td', {}, k.label));
      tr.append(el('td', { class: 'mono' }, k.prefix));
      const scopes = el('td');
      for (const s of k.scopes) scopes.append(el('span', { class: 'pill' }, s));
      tr.append(scopes);
      tr.append(el('td', {}, fmt(k.createdAt)));
      tr.append(el('td', {}, fmt(k.lastUsedAt)));
      tr.append(el('td', {}, k.expiresAt ? fmt(k.expiresAt) : 'never'));
      const actions = el('td');
      const btn = el('button', { type: 'button', class: 'danger' }, 'Revoke');
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke "' + k.label + '"? Agents using it will get 401 within about a minute.')) return;
        btn.disabled = true;
        try {
          await api('/api/keys/' + encodeURIComponent(k.keyId), { method: 'DELETE' });
          await load();
        } catch (err) {
          btn.disabled = false;
          alert(errorText(err.message));
        }
      });
      actions.append(btn);
      tr.append(actions);
      table.append(tr);
    }
    list.append(table);
  }

  async function load() {
    try {
      const { keys } = await api('/api/keys');
      render(keys);
    } catch (err) {
      list.replaceChildren(el('div', { class: 'notice bad' }, errorText(err.message)));
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showStatus('');
      const btn = $('createBtn');
      btn.disabled = true;
      const scopes = [...form.querySelectorAll('input[name=scope]:checked')].map((i) => i.value);
      const expiry = $('expiry').value;
      try {
        const { token } = await api('/api/keys', {
          method: 'POST',
          body: JSON.stringify({
            label: $('label').value,
            scopes,
            expiresInDays: expiry ? Number(expiry) : null,
          }),
        });
        $('token').value = token;
        $('snippet').textContent = JSON.stringify(
          {
            'topology-dojo': {
              url: location.origin + '/mcp',
              headers: { Authorization: 'Bearer ' + token },
            },
          },
          null,
          2,
        );
        reveal.classList.add('show');
        form.reset();
        await load();
      } catch (err) {
        showStatus(errorText(err.message));
      } finally {
        btn.disabled = false;
      }
    });
  }

  $('copyBtn').addEventListener('click', async () => {
    const value = $('token').value;
    try {
      await navigator.clipboard.writeText(value);
      $('copyBtn').textContent = 'Copied';
      setTimeout(() => ($('copyBtn').textContent = 'Copy'), 1500);
    } catch {
      $('token').select();
    }
  });

  load();
})();
`;

export function apiKeysScript(): Response {
  return new Response(SCRIPT, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
