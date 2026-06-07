import type { LinkModel, NodeModel, ResolvedScene } from '../core/model.js';

const NODE_COLORS: Record<NodeModel['type'], string> = {
  ec: '#05cc93',
  switch: '#4aa3ff',
  cloud: '#9b8cff',
  host: '#f5a623',
  router: '#4aa3ff',
  firewall: '#fc6161',
  server: '#7ed6c1',
  generic: '#8893a8',
};

const NODE_GLYPH: Record<NodeModel['type'], string> = {
  ec: 'EC',
  switch: 'SW',
  cloud: '☁',
  host: '▢',
  router: 'R',
  firewall: '🛡',
  server: '▤',
  generic: '●',
};

/** SVG filter/gradient defs, ported from the original svgDefs(). */
function defs(scene: ResolvedScene): string {
  const tunnelGradients = Object.values(scene.topology.links)
    .map((l) => {
      const c = l.color ?? '#05cc93';
      return `<linearGradient id="tun3d-${l.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c}" stop-opacity="1"/>
        <stop offset="0.5" stop-color="${c}" stop-opacity="0.5"/>
        <stop offset="1" stop-color="${c}" stop-opacity="0.15"/>
      </linearGradient>`;
    })
    .join('');

  return `<defs>
    <filter id="tds-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="tds-dof-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    ${tunnelGradients}
  </defs>`;
}

function linkPath(scene: ResolvedScene, link: LinkModel): string {
  const a = scene.elements[link.from];
  const b = scene.elements[link.to];
  if (!a || !b) return '';
  const pts = [{ x: a.x, y: a.y }, ...link.waypoints, { x: b.x, y: b.y }];
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** Faithful port of render3DTunnel from editor.html:1621. */
function render3DTunnel(
  pathD: string,
  color: string,
  linkId: string,
  hasDots: boolean,
): string {
  const tw = 18;
  const gid = `tun3d-${linkId}`;
  let svg = '';
  svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${tw + 6}" stroke-linecap="round" stroke-linejoin="round" opacity=".08" filter="url(#tds-dof-blur)"/>`;
  svg += `<path d="${pathD}" fill="none" stroke="url(#${gid})" stroke-width="${tw}" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`;
  svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${Math.max(4, tw * 0.3)}" stroke-linecap="round" stroke-linejoin="round" opacity=".5" filter="url(#tds-glow)"/>`;
  svg += `<path id="path-${linkId}" d="${pathD}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,-2.7)"/>`;
  if (hasDots) {
    for (let i = 0; i < 3; i++) {
      svg += `<circle r="2.5" fill="${color}" opacity=".7" filter="url(#tds-glow)">
        <animateMotion dur="${2 + i * 0.7}s" repeatCount="indefinite" begin="${i * 0.6}s">
          <mpath href="#path-${linkId}"/>
        </animateMotion>
      </circle>`;
    }
  }
  return svg;
}

function renderLink(scene: ResolvedScene, link: LinkModel): string {
  const el = scene.elements[link.id];
  if (!el || !el.visible) return '';
  const a = scene.elements[link.from];
  const b = scene.elements[link.to];
  if (!a?.visible || !b?.visible) return '';

  const color = link.color ?? '#05cc93';
  const d = linkPath(scene, link);
  const opacity = el.emphasis === 'dim' ? 0.25 : 1;

  let inner: string;
  if (link.type === 'tunnel3d') {
    inner = render3DTunnel(d, color, link.id, el.flowActive);
  } else if (link.type === 'blocked') {
    inner = `<path d="${d}" fill="none" stroke="#fc6161" stroke-width="2.5" stroke-dasharray="6 5"/>`;
  } else {
    inner = `<path id="path-${link.id}" d="${d}" fill="none" stroke="${color}" stroke-width="2.5" opacity=".85"/>`;
    if (el.flowActive) {
      inner += `<circle r="3" fill="${color}" filter="url(#tds-glow)"><animateMotion dur="2s" repeatCount="indefinite"><mpath href="#path-${link.id}"/></animateMotion></circle>`;
    }
  }
  return `<g class="link" data-id="${link.id}" opacity="${opacity}" style="transition:opacity .5s">${inner}</g>`;
}

function renderNode(scene: ResolvedScene, node: NodeModel): string {
  const el = scene.elements[node.id];
  if (!el || !el.visible) return '';

  const color = node.color ?? NODE_COLORS[node.type];
  const glyph = NODE_GLYPH[node.type];
  const focus = el.emphasis === 'focus';
  const opacity = el.emphasis === 'dim' ? 0.25 : 1;
  const ring = focus
    ? `<circle cx="${el.x}" cy="${el.y}" r="34" fill="none" stroke="${color}" stroke-width="2" opacity=".9"><animate attributeName="r" values="30;38;30" dur="2s" repeatCount="indefinite"/></circle>`
    : '';

  // transform on the group enables CSS-tweened Magic Move between beats
  return `<g class="node" data-id="${node.id}" transform="translate(${el.x},${el.y})" opacity="${opacity}" style="transition:transform .6s cubic-bezier(.4,0,.2,1),opacity .5s">
    ${ring ? `<g transform="translate(${-el.x},${-el.y})">${ring}</g>` : ''}
    <circle r="24" fill="rgba(12,18,28,.92)" stroke="${color}" stroke-width="${focus ? 2.5 : 1.5}" ${focus ? `filter="url(#tds-glow)"` : ''}/>
    <text y="5" text-anchor="middle" font-size="15" fill="${color}" font-family="ui-sans-serif,system-ui">${glyph}</text>
    <text y="42" text-anchor="middle" font-size="11" fill="#cdd6e4" font-family="ui-sans-serif,system-ui">${escapeXml(node.label)}</text>
  </g>`;
}

function renderZone(scene: ResolvedScene, zoneId: string): string {
  const z = scene.topology.zones[zoneId];
  if (!z) return '';
  return `<g class="zone"><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="14" fill="${z.color}" fill-opacity=".06" stroke="${z.color}" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="8 6"/><text x="${z.x + 12}" y="${z.y + 22}" font-size="12" fill="${z.color}" font-family="ui-sans-serif,system-ui">${escapeXml(z.label)}</text></g>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<'
      ? '&lt;'
      : c === '>'
        ? '&gt;'
        : c === '&'
          ? '&amp;'
          : c === "'"
            ? '&apos;'
            : '&quot;',
  );
}

/**
 * Render a resolved scene to an SVG string. Pure function of resolved state —
 * the editor and presenter both call this with no knowledge of beats.
 */
export function renderScene(scene: ResolvedScene): string {
  const [vx, vy, vw, vh] = scene.topology.viewBox;
  const zones = Object.keys(scene.topology.zones)
    .map((id) => renderZone(scene, id))
    .join('');
  const links = Object.values(scene.topology.links)
    .map((l) => renderLink(scene, l))
    .join('');
  const nodes = Object.values(scene.topology.nodes)
    .map((n) => renderNode(scene, n))
    .join('');

  return `<svg viewBox="${vx} ${vy} ${vw} ${vh}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="background:radial-gradient(circle at 50% 30%,#0e1622,#070b12)">
    ${defs(scene)}
    <g class="zones">${zones}</g>
    <g class="links">${links}</g>
    <g class="nodes">${nodes}</g>
  </svg>`;
}
