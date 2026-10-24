/**
 * The MCP Apps view (`ui://topology-dojo/viewer.html`) — what `view_topology`
 * shows inline in the conversation.
 *
 * One self-contained page (no external scripts, styles or fonts, so the
 * resource declares an empty CSP allow-list) speaking the MCP Apps protocol
 * (SEP-1865) over `postMessage` JSON-RPC with the host:
 *
 * - `ui/initialize` → `ui/notifications/initialized`;
 * - receives `ui/notifications/tool-result` (the `view_topology` result: page
 *   / layer metadata in `structuredContent`, the first render in `_meta`) and
 *   `ui/notifications/host-context-changed`;
 * - calls the server's own tools through the host (`tools/call`):
 *   `render_svg` to switch pages, layers and theme, `export_topology` for
 *   downloads, handed to the host with `ui/download-file`;
 * - `ui/request-display-mode` for full screen, `ui/notifications/size-changed`
 *   to size the frame.
 *
 * Messages are accepted only from the parent frame. The SVG comes from this
 * server's renderer; it is parsed as SVG and stripped of scripts and event
 * handlers before insertion anyway.
 */
export const VIEWER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Topology Dojo</title>
<style>
  :root {
    --bg: #0e1513; --panel: #151d1b; --line: #26322f; --text: #dfe7e4; --muted: #8a9a95;
    --accent: #01a982; --chip: #1c2624; --chip-on: #0f3d33;
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --bg: #f6f8f7; --panel: #ffffff; --line: #d8dfdc; --text: #1c2624; --muted: #5d6c67;
    --accent: #01805f; --chip: #eef2f0; --chip-on: #d3efe6;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  #app { display: flex; flex-direction: column; height: 100%; min-height: 320px; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px;
    border-bottom: 1px solid var(--line); background: var(--panel); }
  .title { font-weight: 600; margin-right: auto; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; max-width: 40ch; }
  button, select { font: inherit; color: var(--text); background: var(--chip);
    border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; cursor: pointer; }
  button:hover, select:hover { border-color: var(--accent); }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button[aria-pressed="true"] { background: var(--chip-on); border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .group { display: flex; gap: 4px; align-items: center; }
  .layers { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  .layers:empty { display: none; }
  .layers .label { color: var(--muted); align-self: center; margin-right: 2px; }
  #stage { position: relative; flex: 1; overflow: hidden; cursor: grab; touch-action: none; }
  #stage.dragging { cursor: grabbing; }
  #canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  #canvas svg { display: block; }
  #status { position: absolute; left: 10px; bottom: 8px; color: var(--muted); pointer-events: none;
    background: color-mix(in srgb, var(--panel) 85%, transparent); padding: 2px 6px; border-radius: 4px; }
  #status:empty { display: none; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div id="app">
  <header>
    <span class="title" id="title">Topology Dojo</span>
    <div class="group">
      <button id="prev" aria-label="Previous page" title="Previous page">‹</button>
      <select id="page" aria-label="Page"></select>
      <button id="next" aria-label="Next page" title="Next page">›</button>
    </div>
    <div class="group">
      <button id="zoomOut" aria-label="Zoom out" title="Zoom out">−</button>
      <button id="fit" title="Fit to view">fit</button>
      <button id="zoomIn" aria-label="Zoom in" title="Zoom in">+</button>
    </div>
    <button id="theme" title="Toggle light / dark">light</button>
    <select id="download" aria-label="Download" title="Download">
      <option value="">⤓ download…</option>
    </select>
    <button id="full" title="Full screen" hidden>⛶</button>
  </header>
  <div class="layers" id="layers"></div>
  <div id="stage"><div id="canvas"></div><div class="empty" id="empty">Waiting for the diagram…</div><div id="status" role="status" aria-live="polite"></div></div>
</div>
<script>
(function () {
  'use strict';
  var FORMAT_LABELS = { png: 'PNG image', pdf: 'PDF (print size)', drawio: 'draw.io', vsdx: 'Visio (.vsdx)', pptx: 'PowerPoint (.pptx)', mermaid: 'Mermaid', 'cable-schedule': 'Cable schedule (.xlsx)' };
  var state = { id: null, title: '', pageIndex: 0, pages: [], layers: [], visible: null, theme: 'dark', formats: [] };
  var view = { x: 0, y: 0, k: 1, w: 0, h: 0 };
  var nextId = 1, pending = {}, hostCaps = {}, canCall = true;
  var $ = function (id) { return document.getElementById(id); };

  /* ---- JSON-RPC over postMessage --------------------------------------- */
  function send(msg) { window.parent.postMessage(msg, '*'); }
  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; reject(new Error(method + ' timed out')); }
      }, 60000);
    });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && !m.method) {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || 'request failed'));
      else p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-result') onToolResult(m.params || {});
    else if (m.method === 'ui/notifications/host-context-changed') onHostContext(m.params || {});
    else if (m.method === 'ui/notifications/tool-cancelled') status('Cancelled.');
    else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, result: {} }); // ping, teardown
  });

  /* ---- SVG handling ---------------------------------------------------- */
  function cleanSvg(text) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('not an SVG');
    var bad = svg.querySelectorAll('script, foreignObject');
    for (var i = 0; i < bad.length; i++) bad[i].remove();
    var all = svg.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var attrs = all[j].attributes;
      for (var k = attrs.length - 1; k >= 0; k--) {
        var n = attrs[k].name.toLowerCase(), v = attrs[k].value.trim().toLowerCase();
        if (n.indexOf('on') === 0 || ((n === 'href' || n === 'xlink:href') && v.indexOf('javascript:') === 0))
          all[j].removeAttribute(attrs[k].name);
      }
    }
    return document.importNode(svg, true);
  }
  function showSvg(text) {
    var svg;
    try { svg = cleanSvg(text); } catch (e) { status('Could not display this render.'); return; }
    var vb = (svg.getAttribute('viewBox') || '0 0 1050 700').split(/[\s,]+/).map(Number);
    view.w = vb[2] || 1050; view.h = vb[3] || 700;
    svg.setAttribute('width', view.w); svg.setAttribute('height', view.h);
    var canvas = $('canvas');
    canvas.textContent = '';
    canvas.appendChild(svg);
    $('empty').hidden = true;
    fit();
  }

  /* ---- pan / zoom ------------------------------------------------------ */
  function apply() { $('canvas').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'; }
  function fit() {
    var r = $('stage').getBoundingClientRect();
    if (!view.w || !r.width) return;
    view.k = Math.min(r.width / view.w, r.height / view.h) * 0.96;
    view.x = (r.width - view.w * view.k) / 2; view.y = (r.height - view.h * view.k) / 2;
    apply();
  }
  function zoomAt(f, cx, cy) {
    var k = Math.min(16, Math.max(0.05, view.k * f));
    view.x = cx - (cx - view.x) * (k / view.k); view.y = cy - (cy - view.y) * (k / view.k); view.k = k;
    apply();
  }
  var stage = $('stage'), drag = null, pointers = {}, pinch = null;
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('pointerdown', function (e) {
    stage.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null;
    } else { drag = { x: e.clientX, y: e.clientY }; stage.classList.add('dragging'); }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], r = stage.getBoundingClientRect();
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(d / (pinch.d || d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.d = d;
    } else if (drag) {
      view.x += e.clientX - drag.x; view.y += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY }; apply();
    }
  });
  function endPointer(e) { delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinch = null; drag = null; stage.classList.remove('dragging'); }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('dblclick', fit);
  $('zoomIn').onclick = function () { var r = stage.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
  $('zoomOut').onclick = function () { var r = stage.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); };
  $('fit').onclick = fit;
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'SELECT') return;
    if (e.key === '+' || e.key === '=') $('zoomIn').click();
    else if (e.key === '-') $('zoomOut').click();
    else if (e.key === '0') fit();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(state.pageIndex + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(state.pageIndex - 1);
  });

  /* ---- tool calls ------------------------------------------------------ */
  function status(text) { $('status').textContent = text || ''; }
  function callTool(name, args) {
    return request('tools/call', { name: name, arguments: args }).then(function (r) {
      if (r && r.isError) {
        var t = (r.content || []).map(function (c) { return c.text || ''; }).join(' ');
        throw new Error(t.replace(/^Error:\s*/, '') || name + ' failed');
      }
      return r;
    });
  }
  function rerender() {
    if (!state.id || !canCall) return;
    status('Rendering…');
    var args = { topologyId: state.id, pageIndex: state.pageIndex, theme: state.theme };
    if (state.visible) args.visibleLayers = state.visible;
    callTool('render_svg', args).then(function (r) {
      var svg = (r.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
      showSvg(svg); status('');
    }).catch(function (e) { status(e.message); });
  }
  function go(i) {
    if (i < 0 || i >= state.pages.length || i === state.pageIndex) return;
    state.pageIndex = i; $('page').value = String(i); rerender();
  }
  $('page').onchange = function () { go(Number($('page').value)); };
  $('prev').onclick = function () { go(state.pageIndex - 1); };
  $('next').onclick = function () { go(state.pageIndex + 1); };
  $('theme').onclick = function () { setTheme(state.theme === 'dark' ? 'light' : 'dark'); rerender(); };
  $('full').onclick = function () {
    request('ui/request-display-mode', { mode: 'fullscreen' }).then(function () { setTimeout(fit, 50); }).catch(function () {});
  };

  function base64ToBlob(b64, type) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }
  function localDownload(name, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 2000);
  }
  $('download').onchange = function () {
    var format = $('download').value; $('download').value = '';
    if (!format || !state.id) return;
    status('Preparing ' + (FORMAT_LABELS[format] || format) + '…');
    var args = { topologyId: state.id, format: format };
    if (format === 'png') { args.pageIndex = state.pageIndex; args.theme = state.theme; if (state.visible) args.visibleLayers = state.visible; }
    if (format === 'pdf') { args.theme = 'light'; if (state.visible) args.visibleLayers = state.visible; }
    if (format === 'cable-schedule') args.scheduleFormat = 'xlsx';
    callTool('export_topology', args).then(function (r) {
      var info = r.structuredContent || {};
      var name = info.filename || ('topology.' + format), mime = info.mimeType || 'application/octet-stream';
      var block = null;
      (r.content || []).forEach(function (c) {
        if (c.type === 'resource' && c.resource) block = c.resource;
        else if (c.type === 'image') block = { uri: 'topology-dojo://export/' + name, mimeType: c.mimeType, blob: c.data };
      });
      if (!block && info.mermaid) block = { uri: 'topology-dojo://export/' + name, mimeType: mime, text: info.mermaid };
      if (!block) throw new Error('the export returned no file');
      var resource = { uri: block.uri, mimeType: block.mimeType || mime };
      if (block.blob) resource.blob = block.blob; else resource.text = block.text;
      return request('ui/download-file', { contents: [{ type: 'resource', resource: resource }] }).then(function (res) {
        if (res && res.isError) throw new Error('download declined');
        status('Downloaded ' + name);
      }).catch(function () {
        localDownload(name, block.blob ? base64ToBlob(block.blob, resource.mimeType) : new Blob([block.text], { type: resource.mimeType }));
        status('Downloaded ' + name);
      });
    }).catch(function (e) { status(e.message); });
  };

  /* ---- state from the host -------------------------------------------- */
  function setTheme(t) {
    state.theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    $('theme').textContent = state.theme === 'dark' ? 'light' : 'dark';
  }
  function renderChrome() {
    $('title').textContent = state.title || 'Topology Dojo';
    $('title').title = state.title || '';
    var sel = $('page'); sel.textContent = '';
    state.pages.forEach(function (p) {
      var o = document.createElement('option'); o.value = String(p.index);
      o.textContent = (p.index + 1) + '. ' + (p.name || 'Page'); sel.appendChild(o);
    });
    sel.value = String(state.pageIndex);
    var multi = state.pages.length > 1;
    $('prev').hidden = $('next').hidden = sel.hidden = !multi;
    var box = $('layers'); box.textContent = '';
    if (state.layers.length) {
      var lab = document.createElement('span'); lab.className = 'label'; lab.textContent = 'Layers'; box.appendChild(lab);
      state.layers.forEach(function (l) {
        var b = document.createElement('button');
        b.textContent = l.name; b.setAttribute('aria-pressed', String(isVisible(l)));
        b.disabled = !canCall;
        b.onclick = function () { toggleLayer(l.id); };
        box.appendChild(b);
      });
    }
    var dl = $('download');
    while (dl.options.length > 1) dl.remove(1);
    state.formats.forEach(function (f) { var o = document.createElement('option'); o.value = f; o.textContent = FORMAT_LABELS[f] || f; dl.appendChild(o); });
    dl.hidden = !canCall || !state.formats.length;
  }
  function isVisible(l) { return state.visible ? state.visible.indexOf(l.id) !== -1 : l.visible; }
  function toggleLayer(id) {
    var cur = state.layers.filter(isVisible).map(function (l) { return l.id; });
    var i = cur.indexOf(id);
    if (i === -1) cur.push(id); else cur.splice(i, 1);
    state.visible = cur; renderChrome(); rerender();
  }
  function onToolResult(result) {
    var data = result.structuredContent || {};
    if (data.topologyId) {
      state.id = data.topologyId; state.title = data.title || '';
      state.pageIndex = data.pageIndex || 0; state.pages = data.pages || [];
      state.layers = data.layers || []; state.formats = data.formats || [];
      state.visible = null;
      if (data.theme) setTheme(data.theme);
    }
    renderChrome();
    var meta = result._meta || {};
    if (typeof meta['topology-dojo/svg'] === 'string') showSvg(meta['topology-dojo/svg']);
    else rerender();
    if (result.isError) status('The view could not load this topology.');
  }
  function onHostContext(ctx) {
    if (ctx.availableDisplayModes && ctx.availableDisplayModes.indexOf('fullscreen') !== -1) $('full').hidden = false;
    if (ctx.displayMode) setTimeout(fit, 50);
  }

  setTheme('dark');
  request('ui/initialize', {
    appInfo: { name: 'topology-dojo-viewer', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    protocolVersion: '2026-01-26'
  }).then(function (res) {
    hostCaps = (res && res.hostCapabilities) || {};
    // Without server-tool proxying the view still shows the first render.
    canCall = !res || !res.hostCapabilities || !!hostCaps.serverTools;
    renderChrome();
    onHostContext((res && res.hostContext) || {});
    notify('ui/notifications/initialized', {});
    notify('ui/notifications/size-changed', { height: 560 });
  }).catch(function () { status('This host did not answer the MCP Apps handshake.'); });
})();
</script>
</body>
</html>
`;
