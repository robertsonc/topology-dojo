/**
 * Public cinematic sign-in page, separated from the authenticated editor.
 * This is a static, illustrative network scene: no live network telemetry,
 * agent data, or document mutations. Only the already-validated authHref is
 * interpolated, preserving the existing OAuth return-path protections.
 * Assets under /landing/ are served by Workers ASSETS to anonymous visitors.
 */
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#071016" />
<meta name="description" content="Topology Dojo is a network topology canvas for engineers and AI agents. Design, validate, explain, and share networks." />
<title>Topology Dojo - The Network Canvas</title>
<link rel="stylesheet" href="/landing/scene.css" />
<script src="/landing/scene.js" defer></script>
</head>
<body>
<header class="topbar wrap">
<a href="#top" class="brand" aria-label="Topology Dojo home"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4.7 27.3 16 16 27.3 4.7 16Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-opacity=".7"/><circle cx="16" cy="4.7" r="2.7" fill="currentColor"/><circle cx="27.3" cy="16" r="2.7" fill="currentColor"/><circle cx="16" cy="27.3" r="2.7" fill="currentColor"/><circle cx="4.7" cy="16" r="2.7" fill="currentColor"/><circle cx="16" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/></svg><span class="brandname">topology<span>dojo</span></span></a>
<nav class="topnav" aria-label="Main navigation"><a href="#examples" class="navitem">EXAMPLES</a><a href="#system" class="navitem">THE SYSTEM</a><a href="#capabilities" class="navitem">CAPABILITIES</a><a href="https://github.com/robertsonc/topology-dojo" class="navitem" target="_blank" rel="noopener">SOURCE CODE</a><a class="nav-login" href="__AUTH_HREF__" aria-label="Sign in with GitHub">SIGN IN <span aria-hidden="true">&#8599;</span></a></nav>
</header>
<main id="top">
<div class="wrap hero">
<section class="intro"><div class="eyebrow"><span class="spark"></span><span class="bar"></span>THE NETWORK, REIMAGINED</div><h1>Give the<br>invisible<br><span class="gradient">a shape.</span></h1><p class="subtitle">Networks are complex. Understanding them shouldn't be. <b>Design, reason about, and bring topology to life</b> on one canvas built for engineers and AI agents.</p><div class="actions"><a class="primary" href="__AUTH_HREF__" aria-label="Sign in with GitHub to enter Topology Dojo">ENTER THE DOJO&nbsp; &#8594;<span class="cta-caption">Sign in with GitHub</span></a><button class="secondary" type="button" id="replay" aria-label="Replay the network formation animation"><span class="play">&#9654;</span> WATCH IT FORM</button></div><div class="intro-foot"><b>HUMAN + AGENT</b><span class="t"> / </span>ONE CANVAS<span class="t"> / </span>SHARED AUTHORING CONTRACT<br>DIAGRAMS THAT DON'T JUST SHOW A NETWORK. <b>THEY EXPLAIN IT.</b></div></section>
<section class="visual" aria-label="Illustrative animated network topology sequence">
<div class="scene-shell" id="scene" data-phase="3">
<div class="orbit-1"></div><div class="orbit-2"></div>
<div class="hud corner">FIG. 01 / TOPOLOGY SYSTEM</div><div class="hud top"><i></i><b>ILLUSTRATIVE DEMO</b><span class="mini-sep">/</span><span id="hud-state">DISCOVERING</span></div>
<div class="interface-note">EXAMPLE TOPOLOGY <b>ILLUSTRATIVE</b><br>SIMULATED FLOW <b>ACTIVE</b><br>AUTHORING MODEL <b>SHARED</b></div>
<svg class="topo-svg" id="world" viewBox="0 0 940 660" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagram of a SASE network with cloud, edge, data center, and users linked by animated traffic flows">
<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" stroke="#3a8888" stroke-opacity=".095" stroke-width=".8" fill="none"/></pattern><pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" stroke="#3a8888" stroke-opacity=".025" stroke-width=".8" fill="none"/></pattern><radialGradient id="field"><stop stop-color="#14655b" stop-opacity=".19"/><stop offset="1" stop-color="#14655b" stop-opacity="0"/></radialGradient><linearGradient id="flowgrad"><stop stop-color="#33bda4" stop-opacity=".4"/><stop offset=".5" stop-color="#7bffd1"/><stop offset="1" stop-color="#4caaf5" stop-opacity=".5"/></linearGradient></defs>
<rect x="20" y="12" width="900" height="628" fill="url(#smallGrid)"/><rect x="20" y="12" width="900" height="628" fill="url(#grid)"/>
<ellipse cx="482" cy="319" rx="300" ry="230" fill="url(#field)"/>
<g stroke="#396b6e" stroke-opacity=".22" stroke-width="1" fill="none"><path d="M68 83h35m-35 0v32M872 82h-33m33 0v34M68 568h35m-35 0v-32M872 568h-33m33 0v-34"/><circle cx="472" cy="314" r="205" stroke-dasharray="2 18"/><circle cx="472" cy="314" r="270" stroke-dasharray="2 24"/></g>
<g class="link-back"><path d="M269 237C350 175 350 152 401 112"/><path d="M551 116C625 150 628 178 691 230"/><path d="M258 476C369 525 589 522 693 480"/></g>
<g><path id="p1" class="link emph" d="M281 236 C343 237 350 309 410 309"/><path id="p2" class="link" d="M675 227 C615 228 627 312 557 310"/><path id="p3" class="link emph" d="M480 142 C480 192 479 214 480 275"/><path id="p4" class="link" d="M197 452 C198 367 190 327 203 274"/><path id="p5" class="link" d="M755 447 C755 372 749 333 749 263"/><path id="p6" class="link" d="M554 324 C625 329 627 477 694 478"/></g>
<g class="packet"><circle r="4" fill="#69ffca"><animateMotion dur="3.1s" repeatCount="indefinite" path="M281 236 C343 237 350 309 410 309"/></circle><circle r="3.2" fill="#a3dcff"><animateMotion dur="3.7s" begin="-1.6s" repeatCount="indefinite" path="M675 227 C615 228 627 312 557 310"/></circle><circle r="4.4" fill="#80ffd2"><animateMotion dur="2.6s" begin="-.8s" repeatCount="indefinite" path="M480 142 C480 192 479 214 480 275"/></circle><circle r="3" fill="#9beacd"><animateMotion dur="4.4s" begin="-.7s" repeatCount="indefinite" path="M197 452 C198 367 190 327 203 274"/></circle><circle r="3" fill="#b4e8ff"><animateMotion dur="3.5s" begin="-1.4s" repeatCount="indefinite" path="M554 324 C625 329 627 477 694 478"/></circle></g>
<g class="connection-label"><text x="313" y="261" transform="rotate(32 313 261)">TUNNEL</text><text x="592" y="258" transform="rotate(-38 592 258)">FABRIC</text><text x="497" y="217">UPLINK</text><text x="661" y="414">TLS</text></g>
<g class="node" transform="translate(409 76)"><rect class="node-body" width="142" height="67" rx="9"/><circle class="symbol-bg" cx="27" cy="33" r="16"/><path d="M17 35c0-7 8-9 12-5 7-3 12 2 12 7H17" fill="none" stroke="#7fe9d6" stroke-width="1.6"/><text class="node-heading" x="53" y="31">INTERNET</text><text class="node-sub" x="53" y="47">GLOBAL EDGE</text><path d="M10 57h122" stroke="#477d72" stroke-opacity=".35"/></g>
<g class="node" transform="translate(126 198)"><rect class="node-body" width="155" height="77" rx="9"/><circle class="symbol-bg" cx="29" cy="36" r="17"/><path d="M20 42h19m-16-7h13m-10-7h7" stroke="#7fe9d6" stroke-width="1.5" stroke-linecap="round"/><text class="node-heading" x="57" y="34">BRANCH</text><text class="node-sub" x="57" y="51">SD-WAN EDGE</text><circle cx="137" cy="17" r="3" fill="#38d5a3"/></g>
<g class="node" transform="translate(675 189)"><rect class="node-body" width="157" height="74" rx="9"/><circle class="symbol-bg" cx="29" cy="36" r="17"/><path d="M20 28h17v5H20zm0 9h17v5H20z" fill="none" stroke="#7fe9d6" stroke-width="1.3"/><circle cx="24" cy="30" r=".7" fill="#7fe9d6"/><circle cx="24" cy="39" r=".7" fill="#7fe9d6"/><text class="node-heading" x="57" y="34">DATA CENTER</text><text class="node-sub" x="57" y="51">FABRIC / VXLAN</text></g>
<g class="node" transform="translate(119 452)"><rect class="node-body" width="158" height="75" rx="9"/><circle class="symbol-bg" cx="29" cy="36" r="17"/><circle cx="29" cy="30" r="5" fill="none" stroke="#7fe9d6" stroke-width="1.4"/><path d="M19 45c1-10 19-10 20 0" fill="none" stroke="#7fe9d6" stroke-width="1.4"/><text class="node-heading" x="57" y="34">USERS</text><text class="node-sub" x="57" y="51">CAMPUS / REMOTE</text></g>
<g class="node" transform="translate(694 447)"><rect class="node-body" width="147" height="74" rx="9"/><circle class="symbol-bg" cx="29" cy="36" r="17"/><path d="M19 29h20v16H19zM23 25h12" fill="none" stroke="#7fe9d6" stroke-width="1.3"/><text class="node-heading" x="57" y="34">APPS</text><text class="node-sub" x="57" y="51">CLOUD / SAAS</text></g>
<g class="node core" transform="translate(410 275)"><circle class="pulse-ring" cx="77" cy="40" r="107"/><rect class="node-body" width="147" height="84" rx="10"/><circle class="symbol-bg" cx="32" cy="39" r="22"/><path d="M32 23 44 30v15l-12 7-12-7V30zM20 30l12 8 12-8M32 38v14" fill="none" stroke="#acffe0" stroke-width="1.35" stroke-linejoin="round"/><text class="node-heading" x="65" y="33">SASE CORE</text><text class="node-sub" x="65" y="50">CONTROL PLANE</text><text x="65" y="66" fill="#6be6bc" font-size="8" letter-spacing="1.4">6 DEMO PEERS</text></g>
<g><path d="M352 95l8-8m-8 8l8 8M613 500l8-8m-8 8l8 8" fill="none" stroke="#38766e" stroke-width="1.1"/><text x="302" y="154" class="micro">DISCOVER</text><text x="616" y="155" class="micro">COMPOSE</text><text x="340" y="473" class="micro">VALIDATE</text></g>
</svg>
<div class="scene-caption" aria-live="off"><div class="cap-top" id="cap-top">01 / DISCOVER</div><div class="cap-title" id="cap-title">The canvas is waiting.</div><div class="cap-sub" id="cap-sub">From an idea to a visible system.</div></div>
<div class="scene-bars"><button class="step on" type="button" data-step="0" aria-label="Show discover phase"></button><button class="step" type="button" data-step="1" aria-label="Show assemble phase"></button><button class="step" type="button" data-step="2" aria-label="Show connect phase"></button><button class="step" type="button" data-step="3" aria-label="Show flow phase"></button></div>
<div class="hud bottom">6 NODES&nbsp;&nbsp; / &nbsp;&nbsp;6 LINKS&nbsp;&nbsp; / &nbsp;&nbsp;1 SYSTEM</div>
</div>
</section>
</div>
<div class="signal-strip wrap" id="system"><span>DESIGN WITH <strong>INTENT</strong></span><i class="pipe"></i><span>AUTHOR WITH <strong>AGENTS</strong></span><i class="pipe"></i><span>VISUALIZE <strong>THE FLOW</strong></span><i class="pipe"></i><span>EXPORT <strong>ANYWHERE</strong></span></div>
<section class="section wrap" id="capabilities"><div class="section-kicker">NOT JUST A DIAGRAM</div><div class="section-top"><h2>From an idea to a network you can understand.</h2><p>The cinema introduces the product. The product delivers the truth: a precise topology model that engineers and agents can both author.</p></div><div class="features"><article class="feature"><div class="feature-num">01 / COMPOSE</div><div class="feature-art"><div class="f-node">&#9671;</div><span class="f-line"></span><div class="f-node">&#9671;</div><span class="f-line"></span><div class="f-node">&#9671;</div></div><h3>Design with precision.</h3><p>Start with a template or a blank canvas. Build topology through a direct-manipulation editor with rich network vocabulary.</p></article><article class="feature"><div class="feature-num">02 / COLLABORATE</div><div class="feature-art"><div class="f-node">H</div><span class="f-line"></span><div class="f-node dim">+</div><span class="f-line"></span><div class="f-node">AI</div></div><h3>Human + agent, together.</h3><p>Both work from the same document contract. Propose, review, and refine topologies without separate worlds.</p></article><article class="feature"><div class="feature-num">03 / EXPLAIN</div><div class="feature-art"><div class="f-node">A</div><span class="f-line"></span><div class="f-node">&#8594;</div><span class="f-line"></span><div class="f-node">B</div></div><h3>Make every connection count.</h3><p>Illustrate traffic, show topology changes as frames, validate layout, and share diagrams across familiar formats.</p></article></div></section>

<section class="showcase-section wrap" id="examples" aria-labelledby="examples-title">
  <div class="section-kicker">MADE IN THE DOJO</div>
  <div class="section-top"><h2 id="examples-title">Real diagrams. A shared visual language.</h2><p>Topology examples authored with Topology Dojo. The cinematic hero above is an illustration, not a live network feed.</p></div>
  <div class="strip"><div class="reel"><figure class="frame"><img src="/showcase/hub-spoke.webp" alt="Hub-and-spoke WAN topology with six branches converging on a hub" loading="lazy" width="300" height="200"/><figcaption>HUB / SPOKE</figcaption></figure>
<figure class="frame"><img src="/showcase/spine-leaf.webp" alt="Spine-leaf data center fabric with dual-homed hosts" loading="lazy" width="300" height="200"/><figcaption>SPINE / LEAF</figcaption></figure>
<figure class="frame"><img src="/showcase/sdwan.webp" alt="SD-WAN branch connected to an SASE point of presence" loading="lazy" width="300" height="200"/><figcaption>SD-WAN / SASE</figcaption></figure>
<figure class="frame"><img src="/showcase/three-tier.webp" alt="Three-tier web application with a firewall and DMZ web tier" loading="lazy" width="300" height="200"/><figcaption>THREE / TIER</figcaption></figure><figure class="frame" aria-hidden="true"><img src="/showcase/hub-spoke.webp" alt="" loading="lazy" width="300" height="200"/><figcaption>HUB / SPOKE</figcaption></figure>
<figure class="frame" aria-hidden="true"><img src="/showcase/spine-leaf.webp" alt="" loading="lazy" width="300" height="200"/><figcaption>SPINE / LEAF</figcaption></figure>
<figure class="frame" aria-hidden="true"><img src="/showcase/sdwan.webp" alt="" loading="lazy" width="300" height="200"/><figcaption>SD-WAN / SASE</figcaption></figure>
<figure class="frame" aria-hidden="true"><img src="/showcase/three-tier.webp" alt="" loading="lazy" width="300" height="200"/><figcaption>THREE / TIER</figcaption></figure></div></div>
  <div class="still-fallback" aria-hidden="true"><span>HUB / SPOKE</span><span>SPINE / LEAF</span><span>SD-WAN / SASE</span><span>THREE / TIER</span></div>
</section>
</main><footer class="end wrap"><span><b>TOPOLOGY DOJO</b> &middot; THE NETWORK CANVAS</span><span>DESIGN IT. EXPLAIN IT. SHARE IT.</span></footer>
</body>
</html>`;

export function cinematicLoginPage(authHref: string): Response {
  return new Response(TEMPLATE.replaceAll('__AUTH_HREF__', authHref), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy':
        "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'none'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}