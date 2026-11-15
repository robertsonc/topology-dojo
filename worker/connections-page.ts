/**
 * The `/connections` page: the signed-in user's MCP grants (apps connected
 * through the OAuth flow in `worker/mcp-authorize.ts`) with a revoke button
 * each. Same shape as `worker/api-keys-page.ts`: a server-rendered page plus
 * one same-origin script (`/connections.js`), because the Worker's CSP is
 * `script-src 'self'`. The script only talks to `/api/connections` and
 * writes client-supplied names with `textContent`.
 */
import type { SessionUser } from '../src/server/session.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function connectionsPage(user: SessionUser): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connected apps · Topology Dojo</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#2a2f3a;
          --fg:#e6e8ee; --muted:#9aa3b2; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: var(--bg); color: var(--fg); }
  header { display:flex; align-items:center; gap:16px; padding:14px 24px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; flex:1; }
  header a { color: var(--muted); text-decoration:none; }
  header a:hover { color: var(--fg); }
  main { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
  section { background: var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px; }
  p { margin: 6px 0; color: var(--muted); }
  table { width:100%; border-collapse: collapse; margin-top:10px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px; overflow-wrap:anywhere; }
  th { color: var(--muted); font-weight:500; }
  td.mono { font-family: ui-monospace, monospace; font-size:13px; }
  button { padding:6px 12px; border-radius:6px; border:1px solid var(--line); background:#222734; color:var(--bad); cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .empty { color: var(--muted); padding: 10px 0; }
  .notice { padding:10px 12px; border-radius:8px; border:1px solid var(--bad); color: var(--bad); }
</style>
</head>
<body>
<header>
  <h1>Connected apps</h1>
  <span>Signed in as <b>@${esc(user.login)}</b></span>
  <a href="/keys">API keys</a>
  <a href="/">← Editor</a>
  <a href="/logout">Sign out</a>
</header>
<main>
  <section>
    <p>Apps you approved to use the Topology Dojo MCP tools as you. App names
    are chosen by the apps themselves; the redirect address shows where each
    one receives its sign-in. Disconnecting revokes the app's tokens and the
    next connection asks you again.</p>
    <div id="list"><div class="empty">Loading…</div></div>
  </section>
</main>
<script src="/connections.js"></script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

const SCRIPT = String.raw`(() => {
  const list = document.getElementById('list');
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fmt = (secs) => new Date(secs * 1000).toLocaleString();

  async function api(path, init) {
    const res = await fetch(path, { headers: { accept: 'application/json' }, ...init });
    let body = {};
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  function render(connections) {
    list.replaceChildren();
    if (!connections.length) {
      list.append(el('div', { class: 'empty' }, 'No connected apps.'));
      return;
    }
    const table = el('table');
    const head = el('tr');
    for (const h of ['App', 'Redirects to', 'Client ID', 'Connected', ''])
      head.append(el('th', {}, h));
    table.append(head);
    for (const c of connections) {
      const name = c.clientName || 'Unnamed app';
      const tr = el('tr');
      tr.append(el('td', {}, name));
      tr.append(el('td', { class: 'mono' }, c.redirectHosts.join(', ')));
      tr.append(el('td', { class: 'mono' }, c.clientId));
      tr.append(el('td', {}, fmt(c.createdAt)));
      const actions = el('td');
      const btn = el('button', { type: 'button' }, 'Disconnect');
      btn.addEventListener('click', async () => {
        if (!confirm('Disconnect "' + name + '"? Its tokens stop working.')) return;
        btn.disabled = true;
        try {
          await api('/api/connections/' + encodeURIComponent(c.id), { method: 'DELETE' });
          await load();
        } catch (err) {
          btn.disabled = false;
          alert('Could not disconnect: ' + err.message);
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
      const { connections } = await api('/api/connections');
      render(connections);
    } catch (err) {
      list.replaceChildren(el('div', { class: 'notice' }, 'Could not load: ' + err.message));
    }
  }

  load();
})();
`;

export function connectionsScript(): Response {
  return new Response(SCRIPT, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
