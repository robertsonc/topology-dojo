/* ===================================================================
   Topology Design System — Core Engine
   Declarative node/link/step API with cinematic rendering & playback
   =================================================================== */

// Load TopologyGraph — supports both module (Node/test) and browser environments
const _TopologyGraph = (typeof require !== 'undefined')
  ? require('./core/graph.js')
  : (typeof window !== 'undefined' && window.TopologyGraph) || null;

/** Escape user-supplied text for safe insertion into SVG/HTML context. */
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

class TopologyDesigner {

  /* ── Constructor ── */
  constructor(cfg = {}) {
    this.title    = cfg.title    || 'Network Topology';
    this.subtitle = cfg.subtitle || '';
    this.viewBox  = cfg.viewBox  || '0 0 1050 700';
    this.phaseMs      = cfg.phaseMs      || 600;
    this.drawDuration = cfg.drawDuration || 0.7;   // stroke draw-in (seconds)
    this.fadeDuration = cfg.fadeDuration || 0.55;   // phase-in fade  (seconds)

    // ── Graph Model (core/graph.js) ──
    // TopologyGraph owns nodes, links, and anchors with adjacency indexing.
    // The _nodes, _links, _anchors getters below expose raw Maps for backward
    // compatibility — all existing rendering/UI code works without changes.
    if (_TopologyGraph) {
      this._graph = new _TopologyGraph();
    } else {
      // Fallback: construct a minimal shim if graph.js wasn't loaded
      this._graph = null;
      this.__nodes = new Map();
      this.__links = new Map();
      this.__anchors = new Map();
    }

    // Registries (acts/steps stay here — they're choreography, not graph data)
    this._acts     = [];          // ordered acts
    this._steps    = [];          // ordered steps
    this._glossary = [];          // glossary terms

    // State
    this.step        = 0;
    this.playing     = false;
    this.mode        = cfg.mode || 'manual';
    this.speedMs     = cfg.speedMs || 4000;
    this.narCollapsed = false;
    this._timer      = null;
    this._presenting = false;
    this._presentOpts = null;
    this._collapsedActs = new Map();
    this._mounted    = false;
    this._containerId = null;

    // Reduced motion
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;

    // Mobile Safari detection (#182)
    // iOS Safari has limited GPU compositor memory and a ~16MP SVG/Canvas pixel limit.
    // Heavy blur filters + large animated gradients cause blank page rendering.
    this._isMobileSafari = false;
    this._isMobile = false;
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      this._isMobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
      // iOS Safari: contains Safari but not Chrome/CriOS/FxiOS/EdgiOS
      this._isMobileSafari = this._isMobile && /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(ua);
    }

    // Build internal index after steps are registered
    this._stepIndex = {};  // step.id -> 1-based index

    // Interactive editing state
    this.interactiveMode = cfg.interactiveMode || 'select'; // 'select' | 'link'
    this.showNodeIds = cfg.showNodeIds || false;
    this._selectedElement = null;    // currently selected node/link/anchor id
    this._draggingAnchor = null;     // anchor id being dragged
    this._dragOffset = { x: 0, y: 0 };
    this._propertiesPanel = null;    // properties panel element
    this._onModeChange = cfg.onModeChange || null; // callback(mode)

    // ── SVG Diffing Engine (Goal 1a) ──
    this._svgCache = '';              // previous SVG string for diffing
    this._elementCache = new Map();   // elementId -> { svg, step, phase, opacity }
    this._dirtyElements = new Set();  // elements that need re-render

    // ── Plugin System (Goal 1b) ──
    // NOTE: _pluginHooks is intentionally initialized here in the constructor so that
    // lifecycle hooks registered via .on() before mount() are queued and will fire
    // on the first render() after mount() is called.
    this._linkPlugins = new Map();    // custom link type registry
    this._pluginHooks = { beforeRender: [], afterRender: [], onStepChange: [] };

    // ── Link Routing (Goal 1c) ──
    this._routingEnabled = cfg.routing !== false;
    this._routeCache = new Map();     // linkId -> routed path

    // ── Choreography Smoothing (Goal 2b) ──
    this._interpolating = false;
    this._interpolationDuration = cfg.interpolationDuration || 800; // ms
    this._nodePositionSnapshots = new Map(); // step -> Map(nodeId -> {x,y})

    // ── Temporal Digital Twin ──
    // Modes: 'design' (planned topology), 'operational' (live), 'incident' (historical)
    this.temporalMode = cfg.temporalMode || 'design';
    this._incidentData = new Map();    // nodeId/linkId -> { status, latency, jitter, loss }
    this._onTemporalModeChange = cfg.onTemporalModeChange || null;

    // ── Engagement Analytics (#145) ──
    this._analytics = {
      sessionId: Math.random().toString(36).slice(2, 10),
      startTime: Date.now(),
      stepViews: {},        // stepId -> { count, totalMs }
      interactions: [],     // { type, target, timestamp }
      completionRate: 0,    // 0-1 how far user got
      totalSteps: 0,
    };
    this._analyticsStepStart = null;

    // ── Isometric Tilt Mode ──
    this.isometricMode = cfg.isometricMode || false;

    // ── Ghosting Engine ──
    // Support both cfg.ghosting (documented in USER-MANUAL) and cfg.ghostingEnabled (legacy)
    this.ghostingEnabled = (cfg.ghostingEnabled !== undefined ? cfg.ghostingEnabled : cfg.ghosting) !== false;
    this._ghostedActs = new Set();     // act IDs whose elements are ghosted

    // ── Intelligence Layer ──
    this._securityMode = false;
    this._blastRadiusNode = null;      // node ID for blast radius viz
    this._blastRadiusHops = cfg.blastRadiusHops || 2;
    this._pathViolations = [];         // cached validation results

    // ── Conditional Step Logic (Diagram-as-Code 2.0) ──
    this._stateVariables = new Map();  // variable name -> value

    // ── Drag-to-Reposition (#148) ──
    this._draggingNode = null;         // node id being dragged
    this._dragNodeOffset = { x: 0, y: 0 };
    this._coordTooltip = null;         // live coordinate tooltip element
    this._onNodeReposition = cfg.onNodeReposition || null; // callback({id, x, y})
    this._layoutEditMode = false;      // layout edit mode toggle
    this._savedPositions = null;       // saved positions for reset on exit

    // ── Flow Paths ──
    // Overlay paths that follow waypoints through the topology
    this._flowPaths = new Map(); // id -> { waypoints[], color, animation, speed, direction, width, opacity, label, layer, name }

    // ── Policy Markers ──
    // Badges on nodes showing policy actions (inspect, allow, deny, etc.)
    this._policyMarkers = new Map(); // id -> { nodeId, type, color, label, flowPathId, layer }

    // ── Layer System ──
    // Layers group elements into visual planes (physical, flow, policy)
    // Each layer has: { id, name, type, visible, opacity, locked, color, order }
    this._layers = [
      { id: 'physical', name: 'Physical', type: 'physical', visible: true, opacity: 1, locked: false, color: '#01a982', order: 0 },
    ];

    // ── Theme ──
    this._theme = 'dark';

    // ── Zone Annotations (#140) ──
    // Visual region rectangles grouping nodes into named zones
    this._zones = new Map(); // id -> { label, nodes[], color, borderStyle, description, padding, parentZone? }
  }

  /* ── Backward-compatible accessors for graph data ──
     All existing code accesses this._nodes, this._links, this._anchors.
     These getters delegate to TopologyGraph.rawNodes/rawLinks/rawAnchors,
     returning the same Map instances the renderer already expects. */
  get _nodes() { return this._graph ? this._graph.rawNodes : this.__nodes; }
  get _links() { return this._graph ? this._graph.rawLinks : this.__links; }
  get _anchors() { return this._graph ? this._graph.rawAnchors : this.__anchors; }

  /**
   * Access the underlying TopologyGraph for graph-theoretic queries
   * (neighbors, shortest path, connected components, analysis, etc).
   * @returns {TopologyGraph|null}
   */
  get graph() { return this._graph; }

  /* ── Registration API ── */

  /**
   * Register a node.
   * @param {string} id   - Unique identifier (e.g. 'SEA', 'HOST')
   * @param {object} cfg  - { type, x, y, label, sublabel, color, ... }
   *   type: 'ec'|'switch'|'switchEnterprise'|'cloud'|'host'|'connector'|'apps'|'saas'|'server'|'router'|'firewall'|'database'|'idcard'|'ap'|'overlayCloud'|'custom'
   *   variant: (ec only) 'generic'|'virtual'|'physical'|'aws'|'azure'|'gcp'|'oracle'
   */
  node(id, cfg) {
    if (this._graph) {
      this._graph.addNode(id, cfg);
    } else {
      const stored = { ...cfg, id };
      this.__nodes.set(id, stored);
    }
    return this;
  }

  /**
   * Register an extra anchor point (for tunnel endpoints, etc).
   * @param {string} id  - e.g. 'swgSea'
   * @param {object} pos - { x, y }
   */
  anchor(id, pos) {
    if (this._graph) {
      this._graph.addAnchor(id, pos);
    } else {
      this.__anchors.set(id, pos);
    }
    return this;
  }

  /**
   * Register a link.
   * @param {string} id  - Unique identifier
   * @param {object} cfg - { type, from, to, color, label, ... }
   *   type: 'line'|'tunnel'|'wireguard'|'flow'|'packet'|'blocked'|'wifi'|'poe'|'optical'
   *   from/to: node id or anchor id
   *   fromLabel: optional port label near the source endpoint (e.g. 'lan0')
   *   toLabel: optional port label near the destination endpoint (e.g. 'e0')
   *   path: optional custom SVG path string (for flows with curves)
   *   labelPos: optional {x,y} for absolute label placement (flow type)
   *   labelOffset: optional {x,y} — x shifts along the line, y shifts perpendicular
   */
  link(id, cfg) {
    if (this._graph) {
      this._graph.addLink(id, cfg);
    } else {
      const stored = { ...cfg, id };
      this.__links.set(id, stored);
    }
    return this;
  }

  /**
   * Remove a node and clean up any links referencing it.
   * @param {string} id - Node ID to remove
   * @returns {TopologyDesigner} this (for chaining)
   */
  removeNode(id) {
    if (this._graph) {
      // Delegate to TopologyGraph.removeNode() — properly updates adjacency index
      this._graph.removeNode(id);
    } else {
      this.__nodes.delete(id);
      for (const [linkId, linkCfg] of this.__links) {
        if (linkCfg.from === id || linkCfg.to === id) {
          this.__links.delete(linkId);
        }
      }
    }
    // Remove from step phases
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (const phase of step.phases) {
        if (phase.show) {
          phase.show = phase.show.filter(elemId => elemId !== id);
        }
      }
    }
    return this;
  }

  /**
   * Remove a link by ID.
   * @param {string} id - Link ID to remove
   * @returns {TopologyDesigner} this (for chaining)
   */
  removeLink(id) {
    if (this._graph) {
      // Delegate to TopologyGraph.removeLink() — properly updates adjacency index
      this._graph.removeLink(id);
    } else {
      this.__links.delete(id);
    }
    // Remove from step phases
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (const phase of step.phases) {
        if (phase.show) {
          phase.show = phase.show.filter(elemId => elemId !== id);
        }
      }
    }
    this._routeCache.delete(id);
    return this;
  }

  /**
   * Register an act (group of steps).
   * @param {string} id  - e.g. 'a1'
   * @param {object} cfg - { label, color, intro[] }
   */
  act(id, cfg) {
    cfg.id = id;
    cfg.steps = [];
    this._acts.push(cfg);
    return this;
  }

  /**
   * Register a step within an act.
   * @param {string} id  - e.g. 'network'
   * @param {object} cfg - {
   *     act: 'a1',           // act id this step belongs to
   *     name: 'The Network',
   *     goal: 'description...',
   *     focus: ['SEA','LAX'],  // elements to spotlight (empty = all visible)
   *     phases: [
   *       { show: ['SEA'], diff: 'Seattle EC appears' },
   *       { show: ['overlay','sea-inet'], diff: 'Internet + uplinks' },
   *       ...
   *     ],
   *     onRender: (ctx) => svgString  // optional custom render hook
   *   }
   */
  addStep(id, cfg) {
    cfg.id = id;
    // Auto-assign phase delayMs if not set, based on phase index and global phaseMs
    // This allows per-phase timing overrides: { delayMs: 200 }
    // Phases without delayMs fall back to the default: phaseNum * phaseMs
    this._steps.push(cfg);
    const act = this._acts.find(a => a.id === cfg.act);
    if (act) act.steps.push(cfg);
    return this;
  }

  /**
   * Declare that elements should be persistently visible across a range of steps.
   * Removes the need for cross-step conditionals in onRender.
   * Elements listed here are automatically added to the appropriate phase.show arrays.
   *
   * @param {string[]} elementIds - Element IDs to show
   * @param {object} range - { from: 'stepId', until: 'stepId' } (inclusive)
   * @example topo.showDuring(['dashed-line', 'badge'], { from: 'identity', until: 'agent' })
   */
  showDuring(elementIds, range) {
    if (!this._persistentElements) this._persistentElements = [];
    this._persistentElements.push({ ids: elementIds, from: range.from, until: range.until });
    return this;
  }

  /**
   * Register glossary terms.
   * @param {Array} terms - [{ t: 'SSE', d: 'Security Service Edge...' }, ...]
   */
  glossary(terms) {
    this._glossary = terms;
    return this;
  }

  /**
   * Register a layer.
   * @param {string} id   - Unique identifier (e.g. 'flow_1', 'policy_1')
   * @param {object} cfg  - { name, type, visible, opacity, locked, color, order }
   *   type: 'physical'|'flow'|'policy'
   */
  layer(id, cfg) {
    cfg.id = id;
    // Replace existing layer with same id, or add new
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx >= 0) {
      this._layers[idx] = { ...this._layers[idx], ...cfg };
    } else {
      this._layers.push(cfg);
    }
    return this;
  }

  /**
   * Set all layers at once (used by Viewer when loading from Designer).
   * @param {Array} layers - Array of layer objects
   */
  setLayers(layers) {
    if (layers && layers.length > 0) {
      this._layers = layers;
    }
    return this;
  }

  /**
   * Set per-step layer visibility for choreography. The setting persists from
   * this step forward until a later step overrides it (set-and-hold semantics),
   * mirroring how `_getLayerOpacity` resolves the effective opacity at playback.
   *
   * @param {string} stepId   - Step id (as registered via addStep)
   * @param {string} layerId  - Layer id
   * @param {number|null} opacity - 0 hides the layer, 1 fully shows it, a value
   *   in between dims it. Pass null/undefined to clear this step's override.
   * @returns {TopologyDesigner} this (for chaining)
   * @example topo.setStepLayerVisibility('attack', 'flow_1', 0); // hide flow layer during the 'attack' step
   */
  setStepLayerVisibility(stepId, layerId, opacity) {
    const step = this._steps.find(s => s.id === stepId);
    if (!step) return this;
    if (opacity == null) {
      if (step.layerVisibility) {
        delete step.layerVisibility[layerId];
        if (Object.keys(step.layerVisibility).length === 0) delete step.layerVisibility;
      }
      return this;
    }
    if (!step.layerVisibility) step.layerVisibility = {};
    step.layerVisibility[layerId] = { opacity };
    return this;
  }

  /**
   * Register a flow path — an animated overlay that follows waypoints through the topology.
   * @param {string} id  - Unique identifier (e.g. 'fp_1')
   * @param {object} cfg - { waypoints[], color, animation, speed, direction, width, opacity, label, layer, name }
   *   waypoints: ordered array of node/anchor IDs the path passes through
   *   animation: 'particles'|'dashed'|'pulse' (default 'particles')
   *   speed: animation speed in seconds (default 2)
   *   direction: 'forward'|'reverse'|'bidirectional' (default 'forward')
   */
  flowPath(id, cfg) {
    cfg.id = id;
    this._flowPaths.set(id, cfg);
    return this;
  }

  /**
   * Set all flow paths at once (used by Viewer when loading from Designer).
   * @param {Array} entries - Array of [id, cfg] pairs
   */
  setFlowPaths(entries) {
    this._flowPaths = new Map(entries || []);
    return this;
  }

  /**
   * Register a policy marker — a badge on a node showing a policy action.
   * @param {string} id  - Unique identifier (e.g. 'pm_1')
   * @param {object} cfg - { nodeId, type, color, label, flowPathId, layer }
   *   type: 'inspect'|'allow'|'deny'|'redirect'|'encrypt'|'decrypt'|'nat'|'load-balance'|'log'
   */
  policyMarker(id, cfg) {
    cfg.id = id;
    this._policyMarkers.set(id, cfg);
    return this;
  }

  /**
   * Set all policy markers at once (used by Viewer when loading from Designer).
   * @param {Array} entries - Array of [id, cfg] pairs
   */
  setPolicyMarkers(entries) {
    this._policyMarkers = new Map(entries || []);
    return this;
  }

  /* ── Zone Annotations API (#140) ── */

  /**
   * Register a zone — a visual region annotation that groups nodes.
   * Renders as a labeled, dashed-border rectangle encompassing the specified nodes.
   * @param {string} id   - Unique identifier (e.g. 'zone_lan', 'zone_dmz')
   * @param {object} cfg  - { label, nodes[], color, borderStyle, description, padding, labelAlign }
   *   nodes: array of node IDs to encompass
   *   color: zone border/label color (default '#7d8a92')
   *   borderStyle: 'dashed'|'solid'|'dotted' (default 'dashed')
   *   padding: extra padding around nodes in px (default 40)
   *   labelAlign: 'left'|'center'|'right' (default 'left')
   */
  zone(id, cfg) {
    cfg.id = id;
    if (!cfg.color) cfg.color = '#7d8a92';
    if (!cfg.borderStyle) cfg.borderStyle = 'dashed';
    if (!cfg.padding) cfg.padding = 40;
    if (!cfg.nodes) cfg.nodes = [];
    this._zones.set(id, cfg);
    return this;
  }

  /**
   * Remove a zone annotation.
   * @param {string} id - Zone ID to remove
   */
  removeZone(id) {
    this._zones.delete(id);
    return this;
  }

  /**
   * Set all zones at once (used by Viewer when loading from Designer).
   * @param {Array} entries - Array of [id, cfg] pairs
   */
  setZones(entries) {
    this._zones = new Map(entries || []);
    return this;
  }

  /**
   * Get all nodes belonging to a zone and its child zones recursively.
   * @param {string} zoneId
   * @returns {string[]} array of node IDs
   */
  _getZoneNodesRecursive(zoneId) {
    const zone = this._zones.get(zoneId);
    if (!zone) return [];
    const nodes = [...(zone.nodes || [])];
    // Find child zones
    for (const [childId, childZone] of this._zones) {
      if (childZone.parentZone === zoneId) {
        nodes.push(...this._getZoneNodesRecursive(childId));
      }
    }
    return nodes;
  }

  /**
   * Get child zones of a given zone.
   * @param {string} zoneId
   * @returns {string[]} array of child zone IDs
   */
  getChildZones(zoneId) {
    const children = [];
    for (const [childId, childZone] of this._zones) {
      if (childZone.parentZone === zoneId) children.push(childId);
    }
    return children;
  }

  /* ── Link Waypoint API (#139) ── */

  /**
   * Add a waypoint to a link at a given position.
   * @param {string} linkId - The link ID
   * @param {object} pos    - { x, y } position of the waypoint
   * @param {number} [index] - Optional insertion index (appends if omitted)
   * @returns {this}
   */
  addWaypoint(linkId, pos, index) {
    const link = this._links.get(linkId);
    if (!link) return this;
    if (!link.waypoints) link.waypoints = [];
    if (index !== undefined && index >= 0 && index <= link.waypoints.length) {
      link.waypoints.splice(index, 0, { x: pos.x, y: pos.y });
    } else {
      link.waypoints.push({ x: pos.x, y: pos.y });
    }
    this._routeCache.delete(linkId);
    return this;
  }

  /**
   * Remove a waypoint from a link by index.
   * @param {string} linkId - The link ID
   * @param {number} index  - Waypoint index to remove
   * @returns {this}
   */
  removeWaypoint(linkId, index) {
    const link = this._links.get(linkId);
    if (!link || !link.waypoints) return this;
    if (index >= 0 && index < link.waypoints.length) {
      link.waypoints.splice(index, 1);
    }
    this._routeCache.delete(linkId);
    return this;
  }

  /**
   * Clear all waypoints from a link.
   * @param {string} linkId - The link ID
   * @returns {this}
   */
  clearWaypoints(linkId) {
    const link = this._links.get(linkId);
    if (!link) return this;
    link.waypoints = [];
    this._routeCache.delete(linkId);
    return this;
  }

  /**
   * Set link routing style.
   * @param {string} linkId - The link ID
   * @param {string} style  - 'straight'|'orthogonal'|'curved'
   * @returns {this}
   */
  setLinkRouting(linkId, style) {
    const link = this._links.get(linkId);
    if (!link) return this;
    link.lineStyle = style;
    this._routeCache.delete(linkId);
    return this;
  }

  /**
   * Get the effective opacity for a layer at the current step,
   * considering per-step layerVisibility overrides.
   * @param {string} layerId
   * @returns {number} opacity 0-1
   */
  _getLayerOpacity(layerId) {
    // Check per-step layerVisibility (walk backwards from current step)
    for (let i = this.step - 1; i >= 0; i--) {
      const step = this._steps[i];
      if (step.layerVisibility && step.layerVisibility[layerId]) {
        return step.layerVisibility[layerId].opacity;
      }
    }
    // Fall back to the layer's own visibility
    const layer = this._layers.find(l => l.id === layerId);
    if (!layer) return 1;
    return layer.visible ? layer.opacity : 0;
  }

  /**
   * Get the layer id for a given element.
   * @param {string} elemId
   * @returns {string} layer id
   */
  _getElementLayer(elemId) {
    const node = this._nodes.get(elemId);
    if (node) return node.layer || 'physical';
    const link = this._links.get(elemId);
    if (link) return link.layer || 'physical';
    return 'physical';
  }

  /* ── Build index ── */
  _buildIndex() {
    this._stepIndex = {};
    this._steps.forEach((s, i) => { this._stepIndex[s.id] = i + 1; });
    // Compute act start/count
    this._acts.forEach(act => {
      if (act.steps.length === 0) return;
      const first = this._steps.indexOf(act.steps[0]);
      const last  = this._steps.indexOf(act.steps[act.steps.length - 1]);
      act.start = first;
      act.count = last - first + 1;
    });

    // Build reverse show-index for O(1) _findShowPhase lookups
    this._showIndex = new Map();
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (let p = 0; p < step.phases.length; p++) {
        const phase = step.phases[p];
        if (!phase.show) continue;
        for (const elemId of phase.show) {
          if (!this._showIndex.has(elemId)) {
            this._showIndex.set(elemId, { stepId: step.id, phaseNum: p });
          }
        }
      }
    }

    // Process persistent visibility: inject elements into phase.show arrays
    if (this._persistentElements) {
      for (const pe of this._persistentElements) {
        const fromIdx = this._stepIndex[pe.from] || 1;
        const untilIdx = pe.until ? (this._stepIndex[pe.until] || this._steps.length) : this._steps.length;
        for (let i = fromIdx - 1; i < untilIdx && i < this._steps.length; i++) {
          const step = this._steps[i];
          if (!step.phases || step.phases.length === 0) continue;
          // Add to the first phase of each step in range (if not already present)
          const firstPhase = step.phases[0];
          if (!firstPhase.show) firstPhase.show = [];
          for (const id of pe.ids) {
            if (!firstPhase.show.includes(id)) firstPhase.show.push(id);
          }
        }
      }
    }

    // Rebuild show-index after persistent elements injection
    this._showIndex = new Map();
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (let p = 0; p < step.phases.length; p++) {
        const phase = step.phases[p];
        if (!phase.show) continue;
        for (const elemId of phase.show) {
          if (!this._showIndex.has(elemId)) {
            this._showIndex.set(elemId, { stepId: step.id, phaseNum: p });
          }
        }
      }
    }
  }

  /* ══════════════════════════════════════════
     SVG DIFFING ENGINE (Goal 1a)
     Virtual-DOM-lite: only update changed elements
     ══════════════════════════════════════════ */

  /**
   * Compute which elements changed between renders.
   * Returns a Set of element IDs that need re-rendering.
   */
  _computeDirtyElements(prevStep, newStep) {
    const dirty = new Set();

    // Determine which phases are newly visible or changed animation state
    for (const step of this._steps) {
      if (!step.phases) continue;
      const stepIdx = this._stepIndex[step.id];

      for (let p = 0; p < step.phases.length; p++) {
        const phase = step.phases[p];
        if (!phase.show) continue;

        const wasVisible = prevStep >= stepIdx;
        const isVisible = newStep >= stepIdx;
        const wasAnimating = prevStep === stepIdx;
        const isAnimating = newStep === stepIdx;

        // If visibility or animation state changed, mark all phase elements dirty
        if (wasVisible !== isVisible || wasAnimating !== isAnimating) {
          for (const elemId of phase.show) {
            dirty.add(elemId);
          }
        }
      }
    }

    // Focus changes affect opacity of ALL visible elements
    const prevFocus = prevStep > 0 ? new Set(this._steps[prevStep - 1]?.focus || []) : new Set();
    const newFocus = newStep > 0 ? new Set(this._steps[newStep - 1]?.focus || []) : new Set();
    if (prevFocus.size !== newFocus.size || ![...prevFocus].every(f => newFocus.has(f))) {
      // Focus changed — all visible elements are dirty
      for (const step of this._steps) {
        if (!step.phases) continue;
        if (newStep < this._stepIndex[step.id]) continue;
        for (const phase of step.phases) {
          if (phase.show) phase.show.forEach(id => dirty.add(id));
        }
      }
    }

    return dirty;
  }

  /**
   * Incremental SVG update: only re-render dirty element groups.
   * Falls back to full re-render if structural changes detected.
   */
  _incrementalRender(prevStep) {
    const svg = document.getElementById('tds-diagram');
    if (!svg) return false;

    const dirty = this._computeDirtyElements(prevStep, this.step);
    if (dirty.size === 0) return true; // Nothing changed

    // For large changes (>60% of elements), full re-render is faster
    const totalElements = this._nodes.size + this._links.size;
    if (dirty.size > totalElements * 0.6) return false;

    // Patch individual elements in-place
    for (const elemId of dirty) {
      const inner = svg.querySelector(`[data-tds-node="${elemId}"], [data-tds-link="${elemId}"]`);

      // Compute new SVG for this element
      const newSvg = this._renderSingleElement(elemId);

      // For nodes, _renderSingleElement returns the full structure including the
      // _pw opacity/animation wrapper (tds-fade group). We must replace that outer
      // wrapper — not just the inner data-tds-node element — to prevent nesting
      // multiple wrappers whose opacities compound multiplicatively (causing focused
      // nodes to appear dimmed at 0.10–0.15 instead of the correct 1.0).
      let existing = inner;
      if (inner && inner.hasAttribute('data-tds-node')) {
        let el = inner.parentElement;
        while (el && el.parentElement && el.parentElement !== svg) {
          el = el.parentElement;
        }
        if (el && el.parentElement === svg) {
          existing = el;
        }
      }

      if (existing && newSvg) {
        // Replace in-place using a temporary container
        const temp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        temp.innerHTML = newSvg;
        const newEl = temp.firstChild;
        if (newEl) existing.replaceWith(newEl);
      } else if (!inner && newSvg) {
        // Element is newly visible — append
        const temp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        temp.innerHTML = newSvg;
        const newEl = temp.firstChild;
        if (newEl) svg.appendChild(newEl);
      } else if (existing && !newSvg) {
        // Element is no longer visible — remove
        existing.remove();
      }
    }

    return true;
  }

  /**
   * Render a single element by ID (node or link).
   * Returns SVG string or empty string if not visible.
   */
  _renderSingleElement(elemId) {
    const showPhase = this._findShowPhase(elemId);
    if (!showPhase) return '';

    const { stepId, phaseNum } = showPhase;
    const { show } = this._ph(stepId, phaseNum);
    if (!show) return '';

    const nodeCfg = this._nodes.get(elemId);
    if (nodeCfg) {
      const op = this._dimFor(elemId) * (nodeCfg.opacity != null ? nodeCfg.opacity : 1);
      const halo = this._haloForNode(nodeCfg);

      // Resolve overlay cloud spans to actual positions BEFORE rendering
      if (nodeCfg.type === 'overlayCloud' && nodeCfg.spans) {
        nodeCfg._resolvedSpans = nodeCfg.spans.map(id => this._pos(id));
      }

      let nodeSvg = this._renderNodeSVG(nodeCfg);

      if (nodeCfg.label && nodeCfg.type !== 'cloud' && nodeCfg.type !== 'idcard' && nodeCfg.type !== 'overlayCloud') {
        const labelX = nodeCfg.x + (nodeCfg.labelOffsetX || 0);
        const labelY = nodeCfg.labelY || (nodeCfg.y + (nodeCfg.labelOffset || 24));
        nodeSvg += this._renderNodeLabel(labelX, labelY, nodeCfg.label, nodeCfg.sublabel, nodeCfg.labelColor);
      }

      if (this.showNodeIds) {
        nodeSvg += `<text x="${nodeCfg.x}" y="${nodeCfg.y - (nodeCfg.type === 'cloud' ? 42 : 20)}" text-anchor="middle" fill="#fc6161" font-size="7" font-weight="700" opacity=".6">[${elemId}]</text>`;
      }

      if (nodeCfg.sideLabel) {
        const sl = nodeCfg.sideLabel;
        nodeSvg += this._renderSideLabel(sl.x, sl.y, sl.label, sl.sublabel, sl.color || '#01a982', sl.anchor);
      }

      if (nodeCfg.zoneIndicator) {
        nodeSvg += this._renderZoneIndicator(nodeCfg.x, nodeCfg.y, nodeCfg.zoneIndicator);
      }

      nodeSvg = this._focusWrap(elemId, halo, nodeSvg);
      const iso3dAttr = nodeCfg.type && typeof nodeCfg.type === 'string' && nodeCfg.type.startsWith('iso:') ? ' data-tds-iso3d="true"' : '';
      return this._pw(stepId, phaseNum, op, `<g data-tds-node="${elemId}"${iso3dAttr} style="cursor:pointer">${nodeSvg}</g>`);
    }

    const linkCfg = this._links.get(elemId);
    if (linkCfg) {
      const linkSvg = this._renderLinkSVG(linkCfg, stepId, phaseNum);
      return linkSvg ? `<g data-tds-link="${elemId}" style="cursor:pointer">${linkSvg}</g>` : '';
    }

    return '';
  }

  /* ══════════════════════════════════════════
     PLUGIN SYSTEM (Goal 1b)
     Formal interfaces for extending node & link types
     ══════════════════════════════════════════ */

  /**
   * Register a custom node type with a formal plugin interface.
   * Third-party developers can add complex shapes without touching the core engine.
   *
   * @param {string} name - Unique type identifier (e.g. 'rack3d', 'satellite')
   * @param {object} plugin - Plugin definition:
   *   {
   *     render(x, y, cfg) -> SVG string,        // Required: SVG renderer
   *     defaults: { color, ... },                // Optional: default config values
   *     hitBox: { rx, ry } | (cfg) => {rx,ry},   // Optional: collision bounds for link routing
   *     haloColor: string,                        // Optional: focus halo color key
   *     validate: (cfg) => true|string,           // Optional: config validator
   *     meta: { author, version, description }    // Optional: metadata
   *   }
   * @returns {TopologyDesigner} Constructor for chaining
   */
  static registerNodeType(name, plugin) {
    if (typeof plugin === 'function') {
      // Backward compatibility: plain render function
      TopologyDesigner.NODE_TYPES[name] = plugin;
      TopologyDesigner._nodePluginMeta[name] = { render: plugin };
    } else if (plugin && typeof plugin.render === 'function') {
      // Full plugin interface
      const renderFn = (x, y, cfg) => {
        const merged = { ...plugin.defaults, ...cfg };
        if (plugin.validate) {
          const result = plugin.validate(merged);
          if (result !== true) console.warn(`TopologyDesigner plugin "${name}": ${result}`);
        }
        return plugin.render(x, y, merged);
      };
      TopologyDesigner.NODE_TYPES[name] = renderFn;
      TopologyDesigner._nodePluginMeta[name] = plugin;
    } else {
      console.error(`TopologyDesigner.registerNodeType("${name}"): plugin must be a function or {render: fn}`);
    }
    return TopologyDesigner;
  }

  /**
   * Register a custom link type with a formal plugin interface.
   * NOTE: This is a static method — call on the class, not an instance:
   *   TopologyDesigner.registerLinkType('myType', { render: fn })
   *
   * @param {string} name - Unique type identifier (e.g. 'microwave', 'satellite-uplink')
   * @param {object} plugin - Plugin definition:
   *   {
   *     render(ctx) -> SVG string,       // Required: link renderer
   *       ctx: { x1, y1, x2, y2, color, label, opacity, stepId, phaseNum,
   *              show, anim, delay, designer (this), linkCfg }
   *     defaults: { color, ... },         // Optional: default config values
   *     meta: { author, version, desc }   // Optional: metadata
   *   }
   */
  static registerLinkType(name, plugin) {
    if (typeof plugin === 'function') {
      TopologyDesigner._linkPlugins[name] = { render: plugin };
    } else if (plugin && typeof plugin.render === 'function') {
      TopologyDesigner._linkPlugins[name] = plugin;
    } else {
      console.error(`TopologyDesigner.registerLinkType("${name}"): plugin must be a function or {render: fn}`);
    }
    return TopologyDesigner;
  }

  /**
   * Register a lifecycle hook for plugin integration.
   * @param {'beforeRender'|'afterRender'|'onStepChange'} event
   * @param {function} callback
   */
  on(event, callback) {
    // Ensure hooks registry exists (safe to call before or after mount())
    if (!this._pluginHooks) {
      this._pluginHooks = { beforeRender: [], afterRender: [], onStepChange: [] };
    }
    if (this._pluginHooks[event]) {
      this._pluginHooks[event].push(callback);
    }
    return this;
  }

  /**
   * Unregister a lifecycle hook callback.
   * @param {'beforeRender'|'afterRender'|'onStepChange'} event
   * @param {function} callback - The same function reference passed to on()
   * @returns {TopologyDesigner} this (for chaining)
   */
  off(event, callback) {
    if (this._pluginHooks && this._pluginHooks[event]) {
      const idx = this._pluginHooks[event].indexOf(callback);
      if (idx >= 0) this._pluginHooks[event].splice(idx, 1);
    }
    return this;
  }

  /**
   * List all registered node types (built-in + plugins).
   * @returns {string[]}
   */
  static getRegisteredNodeTypes() {
    return Object.keys(TopologyDesigner.NODE_TYPES);
  }

  /**
   * Get node type metadata for the node type browser (#138).
   * Returns categorized types with descriptions for the reference panel.
   * @returns {Array<{category: string, types: Array<{name: string, description: string}>}>}
   */
  static getNodeTypeCatalog() {
    const network = [
      { name: 'ec', description: 'Edge Connect SD-WAN appliance' },
      { name: 'switch', description: 'Network switch' },
      { name: 'switchEnterprise', description: 'Enterprise-class switch with port detail' },
      { name: 'cloud', description: 'Cloud / Internet / WAN' },
      { name: 'host', description: 'Generic host or endpoint' },
      { name: 'connector', description: 'SSE / ZTNA connector' },
      { name: 'apps', description: 'Application cluster' },
      { name: 'saas', description: 'SaaS application' },
      { name: 'server', description: 'Server or VM' },
      { name: 'router', description: 'Network router' },
      { name: 'firewall', description: 'Firewall appliance' },
      { name: 'database', description: 'Database server' },
      { name: 'idcard', description: 'Identity / User card' },
      { name: 'ap', description: 'Wireless access point' },
      { name: 'overlayCloud', description: 'Overlay cloud spanning nodes' },
      { name: 'text', description: 'Text label annotation' },
    ];
    const shapes = [
      { name: 'shape:arrow', description: 'Arrow shape' },
      { name: 'shape:square', description: 'Square' },
      { name: 'shape:rectangle', description: 'Rectangle' },
      { name: 'shape:triangle', description: 'Triangle' },
      { name: 'shape:circle', description: 'Circle' },
      { name: 'shape:ellipse', description: 'Ellipse' },
      { name: 'shape:diamond', description: 'Diamond / Rhombus' },
      { name: 'shape:pentagon', description: 'Pentagon' },
      { name: 'shape:hexagon', description: 'Hexagon' },
      { name: 'shape:star', description: 'Star' },
      { name: 'shape:cross', description: 'Cross / Plus' },
    ];
    // Include custom registered types
    const custom = [];
    for (const name of Object.keys(TopologyDesigner.NODE_TYPES)) {
      if (!network.find(t => t.name === name) && !shapes.find(t => t.name === name)) {
        const meta = TopologyDesigner._nodePluginMeta[name] || {};
        custom.push({ name, description: meta.description || 'Custom node type' });
      }
    }
    const catalog = [
      { category: 'Network', types: network.filter(t => TopologyDesigner.NODE_TYPES[t.name]) },
      { category: 'Shapes', types: shapes.filter(t => TopologyDesigner.NODE_TYPES[t.name]) },
    ];
    if (custom.length > 0) catalog.push({ category: 'Custom', types: custom });
    return catalog;
  }

  /**
   * Render a node type preview SVG at the given size (for the node type browser).
   * @param {string} type - Node type name
   * @param {number} [size=40] - Preview size in px
   * @returns {string} SVG markup string
   */
  static renderNodePreview(type, size = 40) {
    const renderer = TopologyDesigner.NODE_TYPES[type];
    if (!renderer) return '';
    const nodeSvg = renderer(0, 0, '#01a982', {});
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-25 -25 50 50"><g transform="scale(0.7)">${nodeSvg}</g></svg>`;
  }

  /**
   * List all registered link types (built-in + plugins).
   * @returns {string[]}
   */
  static getRegisteredLinkTypes() {
    return ['line', 'tunnel', 'wireguard', 'flow', 'packet', 'blocked', 'wifi', 'poe', 'optical',
            ...Object.keys(TopologyDesigner._linkPlugins)];
  }

  /* ══════════════════════════════════════════
     SMART LINK ROUTING (Goal 1c)
     AABB collision avoidance for links
     ══════════════════════════════════════════ */

  /**
   * Get the bounding box (AABB) for a node.
   * Uses plugin hitBox if available, otherwise estimates from node type.
   */
  _getNodeAABB(nodeCfg) {
    const pluginMeta = TopologyDesigner._nodePluginMeta[nodeCfg.type];
    if (pluginMeta?.hitBox) {
      const hb = typeof pluginMeta.hitBox === 'function' ? pluginMeta.hitBox(nodeCfg) : pluginMeta.hitBox;
      return { x: nodeCfg.x - hb.rx, y: nodeCfg.y - hb.ry, w: hb.rx * 2, h: hb.ry * 2 };
    }
    // Default bounding boxes by node type
    const bounds = {
      ec: { rx: 32, ry: 17 }, switch: { rx: 34, ry: 15 }, switchEnterprise: { rx: 46, ry: 18 },
      cloud: { rx: 64, ry: 36 }, host: { rx: 22, ry: 17 }, connector: { rx: 24, ry: 17 },
      apps: { rx: 20, ry: 24 }, saas: { rx: 36, ry: 22 }, server: { rx: 22, ry: 22 },
      router: { rx: 20, ry: 20 }, firewall: { rx: 24, ry: 18 }, database: { rx: 20, ry: 22 },
      ap: { rx: 20, ry: 22 }, idcard: { rx: 99, ry: 39 },
    };
    const b = bounds[nodeCfg.type] || { rx: 20, ry: 20 };
    return { x: nodeCfg.x - b.rx, y: nodeCfg.y - b.ry, w: b.rx * 2, h: b.ry * 2 };
  }

  /**
   * Check if a line segment from (x1,y1) to (x2,y2) intersects an AABB.
   */
  _lineIntersectsAABB(x1, y1, x2, y2, aabb) {
    const pad = 8; // Extra padding around nodes
    const left = aabb.x - pad, top = aabb.y - pad;
    const right = aabb.x + aabb.w + pad, bottom = aabb.y + aabb.h + pad;

    // Cohen-Sutherland-style quick check
    const dx = x2 - x1, dy = y2 - y1;
    let tMin = 0, tMax = 1;

    const edges = [
      { p: -dx, q: x1 - left },
      { p: dx, q: right - x1 },
      { p: -dy, q: y1 - top },
      { p: dy, q: bottom - y1 },
    ];

    for (const { p, q } of edges) {
      if (Math.abs(p) < 1e-8) {
        if (q < 0) return false;
      } else {
        const t = q / p;
        if (p < 0) { if (t > tMax) return false; tMin = Math.max(tMin, t); }
        else { if (t < tMin) return false; tMax = Math.min(tMax, t); }
      }
    }
    return tMin <= tMax;
  }

  /**
   * Compute a routed path for a link that avoids crossing through nodes.
   * Uses a simple orthogonal detour around obstructing nodes.
   * Returns an SVG path string, or null if no routing needed.
   */
  _routeLink(fromPos, toPos, linkId) {
    if (!this._routingEnabled) return null;

    // Check cache
    const cacheKey = `${fromPos.x},${fromPos.y}-${toPos.x},${toPos.y}-${this.step}`;
    if (this._routeCache.has(linkId)) {
      const cached = this._routeCache.get(linkId);
      if (cached.key === cacheKey) return cached.path;
    }

    const obstructions = [];

    // Get the from/to node IDs for this link
    const linkCfg = this._links.get(linkId);
    const fromId = linkCfg?.from;
    const toId = linkCfg?.to;

    // Find nodes that the direct line would cross through (excluding endpoints)
    for (const [nodeId, nodeCfg] of this._nodes) {
      if (nodeId === fromId || nodeId === toId) continue;
      // Only check visible nodes
      const showPhase = this._findShowPhase(nodeId);
      if (!showPhase) continue;
      if (this.step < this._stepIndex[showPhase.stepId]) continue;

      const aabb = this._getNodeAABB(nodeCfg);
      if (this._lineIntersectsAABB(fromPos.x, fromPos.y, toPos.x, toPos.y, aabb)) {
        obstructions.push({ id: nodeId, aabb, cx: nodeCfg.x, cy: nodeCfg.y });
      }
    }

    if (obstructions.length === 0) {
      this._routeCache.set(linkId, { key: cacheKey, path: null });
      return null;
    }

    // Sort obstructions along the line direction
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    obstructions.sort((a, b) => {
      const ta = ((a.cx - fromPos.x) * dx + (a.cy - fromPos.y) * dy) / (len * len);
      const tb = ((b.cx - fromPos.x) * dx + (b.cy - fromPos.y) * dy) / (len * len);
      return ta - tb;
    });

    // Build a detour path with smooth curves around each obstruction
    let path = `M${fromPos.x},${fromPos.y}`;
    let cx = fromPos.x, cy = fromPos.y;

    for (const obs of obstructions) {
      const aabb = obs.aabb;
      const midX = aabb.x + aabb.w / 2;
      const midY = aabb.y + aabb.h / 2;

      // Determine detour side: go around whichever side is shorter
      const perpX = -dy / len, perpY = dx / len;
      const dot = (cx - midX) * perpX + (cy - midY) * perpY;
      const side = dot >= 0 ? 1 : -1;

      const detourDist = (Math.max(aabb.w, aabb.h) / 2) + 20;
      const wayX = midX + perpX * detourDist * side;
      const wayY = midY + perpY * detourDist * side;

      // Quadratic Bezier curve around the obstruction
      path += ` Q${wayX},${wayY} ${midX + dx/len * (aabb.w/2 + 10)},${midY + dy/len * (aabb.h/2 + 10)}`;
      cx = midX + dx/len * (aabb.w/2 + 10);
      cy = midY + dy/len * (aabb.h/2 + 10);
    }

    path += ` L${toPos.x},${toPos.y}`;
    this._routeCache.set(linkId, { key: cacheKey, path });
    return path;
  }

  /**
   * Clear the route cache (called when nodes move or topology changes).
   */
  _clearRouteCache() {
    this._routeCache.clear();
  }

  /* ══════════════════════════════════════════
     CHOREOGRAPHY SMOOTHING (Goal 2b)
     Smooth interpolation between step positions
     ══════════════════════════════════════════ */

  /**
   * Snapshot current node positions for the current step.
   * Called during _buildIndex to prepare position data.
   */
  _snapshotPositions() {
    const snapshot = new Map();
    for (const [id, cfg] of this._nodes) {
      snapshot.set(id, { x: cfg.x, y: cfg.y });
    }
    this._nodePositionSnapshots.set(this.step, snapshot);
  }

  /**
   * Smoothly animate node position changes between steps.
   * Uses requestAnimationFrame for 60fps interpolation.
   *
   * @param {number} fromStep - Previous step
   * @param {number} toStep - Target step
   * @param {function} onComplete - Called when interpolation finishes
   */
  _interpolateStep(fromStep, toStep, onComplete) {
    if (this._interpolating || this.reducedMotion) {
      if (onComplete) onComplete();
      return;
    }

    // Collect nodes that have different positions in different steps
    const movingNodes = [];
    for (const [id, cfg] of this._nodes) {
      if (cfg._positions && cfg._positions[toStep]) {
        const target = cfg._positions[toStep];
        if (cfg.x !== target.x || cfg.y !== target.y) {
          movingNodes.push({
            id, cfg,
            fromX: cfg.x, fromY: cfg.y,
            toX: target.x, toY: target.y,
          });
        }
      }
    }

    if (movingNodes.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    this._interpolating = true;
    const duration = this._interpolationDuration;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-in-out cubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      for (const node of movingNodes) {
        node.cfg.x = node.fromX + (node.toX - node.fromX) * ease;
        node.cfg.y = node.fromY + (node.toY - node.fromY) * ease;
      }

      this._clearRouteCache();
      document.getElementById('tds-diagram').innerHTML = this._renderSVG();

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this._interpolating = false;
        if (onComplete) onComplete();
      }
    };

    requestAnimationFrame(animate);
  }

  /**
   * Set position keyframes for a node across different steps.
   * Enables smooth sliding between acts/steps instead of snapping.
   *
   * @param {string} nodeId - Node identifier
   * @param {object} positions - { stepNumber: {x, y}, ... }
   * @returns {TopologyDesigner} this (for chaining)
   *
   * @example
   *   td.setNodePositions('SEA', { 1: {x:200, y:300}, 5: {x:500, y:300} });
   */
  setNodePositions(nodeId, positions) {
    const node = this._nodes.get(nodeId);
    if (node) {
      node._positions = positions;
    }
    return this;
  }

  /* ══════════════════════════════════════════
     TEMPORAL DIGITAL TWIN
     Toggle between Design, Operational, and Incident states
     ══════════════════════════════════════════ */

  /**
   * Set the temporal observation mode.
   * @param {'design'|'operational'|'incident'} mode
   * @returns {TopologyDesigner} this
   */
  setTemporalMode(mode) {
    if (!['design', 'operational', 'incident'].includes(mode)) return this;
    this.temporalMode = mode;
    if (this._onTemporalModeChange) this._onTemporalModeChange(mode);
    if (this._mounted) this.render();
    return this;
  }

  /**
   * Set incident/operational data for a node or link.
   * Used in 'operational' and 'incident' modes to visualize live metrics.
   * @param {string} elementId - Node or link ID
   * @param {object} data - { status: 'healthy'|'degraded'|'down'|'breached',
   *                          latency: number(ms), jitter: number(ms), loss: number(%) }
   * @returns {TopologyDesigner} this
   */
  setElementState(elementId, data) {
    this._incidentData.set(elementId, { ...data });
    if (this._mounted && this.temporalMode !== 'design') this.render();
    return this;
  }

  /**
   * Bulk-set state data for multiple elements.
   * @param {object} stateMap - { elementId: { status, latency, jitter, loss }, ... }
   */
  setStateData(stateMap) {
    for (const [id, data] of Object.entries(stateMap)) {
      this._incidentData.set(id, { ...data });
    }
    if (this._mounted && this.temporalMode !== 'design') this.render();
    return this;
  }

  /**
   * Get the temporal state class/filter for an element.
   * Returns SVG filter ID or empty string depending on element status.
   */
  _getTemporalEffect(elementId) {
    if (this.temporalMode === 'design') return { filter: '', statusColor: '', particleSpeed: 2, overlay: '' };
    const data = this._incidentData.get(elementId);
    if (!data) {
      // In operational mode, no data means healthy
      if (this.temporalMode === 'operational') {
        return { filter: '', statusColor: '#05cc93', particleSpeed: 2, overlay: '' };
      }
      return { filter: '', statusColor: '', particleSpeed: 2, overlay: '' };
    }

    const status = data.status || 'healthy';
    switch (status) {
      case 'healthy':
        return { filter: '', statusColor: '#05cc93', particleSpeed: 2, overlay: '' };
      case 'degraded':
        return {
          filter: 'url(#tds-temporal-jitter)',
          statusColor: '#deb146',
          particleSpeed: Math.max(0.5, 2 + (data.latency || 0) / 50),
          overlay: 'degraded'
        };
      case 'down':
        return {
          filter: 'url(#tds-temporal-down)',
          statusColor: '#fc6161',
          particleSpeed: 0,
          overlay: 'down'
        };
      case 'breached':
        return {
          filter: 'url(#tds-temporal-breach)',
          statusColor: '#fc6161',
          particleSpeed: 0.5,
          overlay: 'breached'
        };
      default:
        return { filter: '', statusColor: '', particleSpeed: 2, overlay: '' };
    }
  }

  /**
   * Render temporal state badge overlay for a node.
   */
  _renderTemporalBadge(x, y, elementId) {
    if (this.temporalMode === 'design') return '';
    const data = this._incidentData.get(elementId);
    if (!data) return '';

    const effect = this._getTemporalEffect(elementId);
    if (!effect.statusColor) return '';

    let badge = '';
    const status = data.status || 'healthy';
    const bx = x + 22, by = y - 22;

    // Status indicator dot
    badge += `<circle cx="${bx}" cy="${by}" r="5" fill="${effect.statusColor}" filter="url(#tds-bloom)"/>`;

    // Pulsing ring for degraded/down/breached
    if (status !== 'healthy' && !this.reducedMotion) {
      badge += `<circle cx="${bx}" cy="${by}" r="5" fill="none" stroke="${effect.statusColor}" stroke-width=".8">
        <animate attributeName="r" values="5;12;5" dur="${status === 'down' ? '1' : '2'}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".6;0;.6" dur="${status === 'down' ? '1' : '2'}s" repeatCount="indefinite"/>
      </circle>`;
    }

    // Metrics label for operational/incident mode
    if (data.latency != null || data.jitter != null || data.loss != null) {
      const metrics = [];
      if (data.latency != null) metrics.push(`${data.latency}ms`);
      if (data.jitter != null) metrics.push(`±${data.jitter}ms`);
      if (data.loss != null) metrics.push(`${data.loss}%↓`);
      const text = metrics.join(' · ');
      const tw = text.length * 4.5 + 12;
      badge += `<rect x="${bx - tw/2}" y="${by + 8}" width="${tw}" height="12" rx="3" fill="url(#tds-labelGlass)" stroke="${effect.statusColor}" stroke-width=".4" opacity=".9"/>`;
      badge += `<text x="${bx}" y="${by + 16}" text-anchor="middle" fill="${effect.statusColor}" font-size="6" font-weight="600">${_esc(text)}</text>`;
    }

    return badge;
  }

  /* ══════════════════════════════════════════
     INTELLIGENCE LAYER
     Path validation & blast radius visualization
     ══════════════════════════════════════════ */

  /**
   * Validate that a path between two nodes passes through required security nodes.
   * Returns validation result with violation details.
   * @param {string} fromId - Source node ID
   * @param {string} toId - Destination node ID
   * @param {object} [rules] - { requireTypes: ['firewall'], forbidDirect: true }
   * @returns {{ valid: boolean, path: string[], violations: string[] }}
   */
  validatePath(fromId, toId, rules = {}) {
    if (!this._graph) return { valid: true, path: [], violations: [] };

    const requireTypes = rules.requireTypes || ['firewall'];
    const path = this._graph.shortestPath(fromId, toId);
    if (path.length === 0) return { valid: false, path: [], violations: ['No path exists'] };

    const violations = [];
    const fromNode = this._nodes.get(fromId);
    const toNode = this._nodes.get(toId);

    // Check if any required security type exists in the path
    for (const reqType of requireTypes) {
      const hasType = path.some(nodeId => {
        const node = this._nodes.get(nodeId);
        return node && node.type === reqType;
      });
      if (!hasType) {
        violations.push(`Missing ${reqType} between ${fromNode?.label || fromId} and ${toNode?.label || toId}`);
      }
    }

    // Check for direct cloud-to-database connections without firewall
    if (rules.forbidDirect !== false) {
      const sensitiveTypes = new Set(['database', 'apps', 'server']);
      const publicTypes = new Set(['cloud', 'saas']);
      if (fromNode && toNode) {
        const fromPublic = publicTypes.has(fromNode.type);
        const toSensitive = sensitiveTypes.has(toNode.type);
        const fromSensitive = sensitiveTypes.has(fromNode.type);
        const toPublic = publicTypes.has(toNode.type);
        if ((fromPublic && toSensitive) || (fromSensitive && toPublic)) {
          const hasFirewall = path.some(id => {
            const n = this._nodes.get(id);
            return n && n.type === 'firewall';
          });
          if (!hasFirewall) {
            violations.push('Security Violation: Direct path between public and private resources without firewall');
          }
        }
      }
    }

    return { valid: violations.length === 0, path, violations };
  }

  /**
   * Validate all links in the topology for security violations.
   * @param {object} [rules] - Validation rules
   * @returns {Array<{ linkId, from, to, violations }>}
   */
  validateTopology(rules = {}) {
    const results = [];
    for (const [linkId, linkCfg] of this._links) {
      const result = this.validatePath(linkCfg.from, linkCfg.to, rules);
      if (!result.valid) {
        results.push({ linkId, from: linkCfg.from, to: linkCfg.to, violations: result.violations });
      }
    }
    this._pathViolations = results;
    if (this._mounted) this.render();
    return results;
  }

  /**
   * Toggle security analysis mode. When active, shows path violations
   * and enables blast radius on node click.
   * @param {boolean} [enabled]
   * @returns {boolean} current state
   */
  toggleSecurityMode(enabled) {
    this._securityMode = enabled !== undefined ? enabled : !this._securityMode;
    if (this._securityMode) {
      this.validateTopology();
    } else {
      this._pathViolations = [];
      this._blastRadiusNode = null;
    }
    if (this._mounted) this.render();
    return this._securityMode;
  }

  /**
   * Compute blast radius from a node — all nodes reachable within N hops.
   * @param {string} nodeId - Center node
   * @param {number} [hops] - Max hop count (default: this._blastRadiusHops)
   * @returns {Set<string>} reachable node IDs
   */
  getBlastRadius(nodeId, hops) {
    if (!this._graph) return new Set([nodeId]);
    const maxHops = hops ?? this._blastRadiusHops;
    const reachable = new Set([nodeId]);
    let frontier = new Set([nodeId]);

    for (let h = 0; h < maxHops; h++) {
      const next = new Set();
      for (const id of frontier) {
        for (const neighbor of this._graph.getNeighbors(id)) {
          if (!reachable.has(neighbor)) {
            reachable.add(neighbor);
            next.add(neighbor);
          }
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }
    return reachable;
  }

  /**
   * Set a node as the blast radius center. All nodes outside the radius
   * will be dimmed in security mode.
   * @param {string|null} nodeId - Node ID or null to clear
   */
  setBlastRadiusNode(nodeId) {
    this._blastRadiusNode = nodeId;
    if (this._mounted) this.render();
    return this;
  }

  /**
   * Render security violation overlay for a link.
   */
  _renderViolationOverlay(linkId) {
    if (!this._securityMode || this._pathViolations.length === 0) return '';
    const violation = this._pathViolations.find(v => v.linkId === linkId);
    if (!violation) return '';

    const from = this._pos(violation.from);
    const to = this._pos(violation.to);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;

    let svg = '';
    // Pulsing red halo on the link midpoint
    if (!this.reducedMotion) {
      svg += `<circle cx="${mx}" cy="${my}" r="8" fill="none" stroke="#fc6161" stroke-width="1.5" opacity=".6">
        <animate attributeName="r" values="8;18;8" dur="1.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".6;0;.6" dur="1.5s" repeatCount="indefinite"/>
      </circle>`;
    }
    // Warning icon
    svg += `<circle cx="${mx}" cy="${my}" r="10" fill="#292d3a" stroke="#fc6161" stroke-width="1.2"/>`;
    svg += `<text x="${mx}" y="${my + 1}" text-anchor="middle" fill="#fc6161" font-size="12" font-weight="700" dominant-baseline="central">!</text>`;

    // Violation tooltip
    const reason = violation.violations[0] || 'Security violation';
    const tw = Math.min(reason.length * 4.5 + 16, 200);
    svg += `<rect x="${mx - tw/2}" y="${my + 14}" width="${tw}" height="14" rx="3" fill="#292d3a" stroke="#fc6161" stroke-width=".5" opacity=".9"/>`;
    svg += `<text x="${mx}" y="${my + 23}" text-anchor="middle" fill="#fc6161" font-size="6" font-weight="600">${_esc(reason.substring(0, 44))}</text>`;

    return svg;
  }

  /* ══════════════════════════════════════════
     GHOSTING ENGINE
     Previous act elements desaturate/scale instead of vanishing
     ══════════════════════════════════════════ */

  /**
   * Determine if an element belongs to a previous (ghosted) act.
   * Returns ghost opacity if ghosted, or null if not.
   */
  _getGhostState(elementId) {
    if (!this.ghostingEnabled || this.step <= 0) return null;

    const curAct = this._curAct();
    if (!curAct) return null;

    // Find which act this element was first shown in
    const showPhase = this._findShowPhase(elementId);
    if (!showPhase) return null;

    const elemStepIdx = this._stepIndex[showPhase.stepId] - 1;
    const elemAct = this._actFor(elemStepIdx);
    if (!elemAct || elemAct.id === curAct.id) return null;

    // Element belongs to a previous act — ghost it
    const elemActIdx = this._acts.indexOf(elemAct);
    const curActIdx = this._acts.indexOf(curAct);
    if (elemActIdx < curActIdx) {
      // Deeper in the past = more ghosted
      const depth = curActIdx - elemActIdx;
      return Math.max(0.08, 0.25 - depth * 0.05);
    }
    return null;
  }

  /* ══════════════════════════════════════════
     CONDITIONAL STEP LOGIC (Diagram-as-Code 2.0)
     State variables and conditional step evaluation
     ══════════════════════════════════════════ */

  /**
   * Set a state variable for conditional logic.
   * @param {string} name - Variable name (e.g. 'firewall.status')
   * @param {*} value - Variable value
   * @returns {TopologyDesigner} this
   */
  setState(name, value) {
    this._stateVariables.set(name, value);
    if (this._mounted) this.render();
    return this;
  }

  /**
   * Get a state variable value.
   * @param {string} name
   * @returns {*}
   */
  getState(name) {
    return this._stateVariables.get(name);
  }

  /**
   * Evaluate a condition string against current state variables.
   * Supports: 'variable == "value"', 'variable != "value"', 'variable' (truthy check)
   * @param {string} condition
   * @returns {boolean}
   */
  _evaluateCondition(condition) {
    if (!condition) return true;

    // Parse: 'variable == "value"' or "variable != 'value'" or 'variable'
    const eqMatch = condition.match(/^([\w.]+)\s*==\s*['"](.+)['"]$/);
    if (eqMatch) {
      return String(this._stateVariables.get(eqMatch[1])) === eqMatch[2];
    }
    const neqMatch = condition.match(/^([\w.]+)\s*!=\s*['"](.+)['"]$/);
    if (neqMatch) {
      return String(this._stateVariables.get(neqMatch[1])) !== neqMatch[2];
    }
    const gtMatch = condition.match(/^([\w.]+)\s*>\s*(\d+)$/);
    if (gtMatch) {
      return (Number(this._stateVariables.get(gtMatch[1])) || 0) > Number(gtMatch[2]);
    }
    const ltMatch = condition.match(/^([\w.]+)\s*<\s*(\d+)$/);
    if (ltMatch) {
      return (Number(this._stateVariables.get(ltMatch[1])) || 0) < Number(ltMatch[2]);
    }

    // Truthy check
    return !!this._stateVariables.get(condition);
  }

  /**
   * Execute conditional actions defined on a step/phase.
   * Phase config can include:
   *   condition: 'firewall.status == "breached"'
   *   actions: [
   *     { changeLink: 'tunnel-01', toType: 'blocked', reason: 'Quarantine' },
   *     { changeNode: 'FW', cfg: { color: '#fc6161' } },
   *     { showElements: ['alert-badge'] },
   *     { hideElements: ['tunnel-01'] }
   *   ]
   */
  _evaluatePhaseConditions(phase) {
    if (!phase.condition) return;
    if (!this._evaluateCondition(phase.condition)) return;

    const actions = phase.actions || [];
    for (const action of actions) {
      if (action.changeLink) {
        const link = this._links.get(action.changeLink);
        if (link) {
          if (action.toType) link.type = action.toType;
          if (action.reason) link.reason = action.reason;
          if (action.color) link.color = action.color;
          if (action.label) link.label = action.label;
        }
      }
      if (action.changeNode) {
        const node = this._nodes.get(action.changeNode);
        if (node) {
          Object.assign(node, action.cfg || {});
        }
      }
      if (action.setState) {
        for (const [k, v] of Object.entries(action.setState)) {
          this._stateVariables.set(k, v);
        }
      }
    }
  }

  /* ══════════════════════════════════════════
     ISOMETRIC TILT MODE
     Pseudo-3D orthographic projection
     ══════════════════════════════════════════ */

  /**
   * Toggle isometric tilt mode.
   * @param {boolean} [enabled]
   * @returns {boolean} current state
   */
  // ── Theme API (#183) ──
  setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') return this;
    this._theme = theme;
    const root = this._el || document.querySelector('.tds-root');
    if (root) {
      root.classList.toggle('tds-light', theme === 'light');
    }
    // Update SVG background rect if mounted
    const bg = document.getElementById('tds-bg-rect');
    if (bg) {
      bg.setAttribute('fill', theme === 'light' ? '#f0f1f3' : '#1d1f27');
    }
    localStorage.setItem('tds-theme', theme);
    // Update toggle button icon
    const btn = document.getElementById('tds-themeBtn');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
    return this;
  }

  getTheme() { return this._theme || 'dark'; }

  toggleIsometric(enabled) {
    this.isometricMode = enabled !== undefined ? enabled : !this.isometricMode;
    if (this._mounted) {
      const canvas = document.querySelector('.tds-canvas');
      if (canvas) {
        canvas.classList.toggle('tds-isometric', this.isometricMode);
      }
      // Counter-rotate text labels
      const svg = document.getElementById('tds-diagram');
      if (svg) {
        svg.classList.toggle('tds-isometric-svg', this.isometricMode);
      }
    }
    return this.isometricMode;
  }

  /* ── Visibility & Phase helpers ── */
  _vis(stepId) { const idx = this._stepIndex[stepId]; return idx != null && this.step >= idx; }

  /**
   * Get phase state for a step/phase pair.
   * Supports per-phase timing overrides via phase.delayMs.
   */
  _ph(stepId, phaseNum) {
    const idx = this._stepIndex[stepId];
    if (idx == null) return { show: false, anim: false, delay: 0, effect: 'appear' };
    if (this.step > idx) return { show: true,  anim: false, delay: 0, effect: 'appear' };
    if (this.step < idx) return { show: false, anim: false, delay: 0, effect: 'appear' };
    // Check for per-phase timing override and effect type
    const step = this._steps[idx - 1];
    const phase = step?.phases?.[phaseNum];
    const delayMs = phase?.delayMs ?? (phaseNum * this.phaseMs);
    const effect = phase?.effect || 'appear';
    return { show: true, anim: !this.reducedMotion, delay: delayMs / 1000, effect };
  }

  /* ── Position Memoization ── */
  /** Cached position lookup — resolves once per render cycle */
  _posCache = null;
  _posCached(id) {
    if (!this._posCache) this._posCache = new Map();
    if (this._posCache.has(id)) return this._posCache.get(id);
    const p = this._pos(id);
    this._posCache.set(id, p);
    return p;
  }
  _clearPosCache() { this._posCache = null; }

  /* ── Path Helpers ── */
  /**
   * Build a straight-line SVG path through a sequence of node/anchor IDs.
   * @param {...string} ids - Node or anchor IDs to connect
   * @returns {string} SVG path string (M...L...L...)
   * @example topo.pathThrough('HOST', 'SSW', 'SEA', 'NAC')
   */
  pathThrough(...ids) {
    if (ids.length === 0) return '';
    const first = this._posCached(ids[0]);
    let d = `M${first.x},${first.y}`;
    for (let i = 1; i < ids.length; i++) {
      const p = this._posCached(ids[i]);
      d += ` L${p.x},${p.y}`;
    }
    return d;
  }

  /**
   * Build a curved SVG path between two node/anchor IDs.
   * @param {string} fromId - Source node/anchor ID
   * @param {string} toId - Destination node/anchor ID
   * @param {object} [opts] - { cx, cy, bulge } for curve control
   * @returns {string} SVG path string (cubic bezier)
   * @example topo.pathBetween('SEA', 'LAX', { bulge: -60 })
   */
  pathBetween(fromId, toId, opts = {}) {
    const a = this._posCached(fromId);
    const b = this._posCached(toId);
    const bulge = opts.bulge || 0;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    // Perpendicular bulge
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const cx1 = mx + nx * bulge, cy1 = my + ny * bulge;
    if (opts.cx !== undefined && opts.cy !== undefined) {
      return `M${a.x},${a.y} Q${opts.cx},${opts.cy} ${b.x},${b.y}`;
    }
    return `M${a.x},${a.y} C${a.x + (cx1 - a.x) * 0.5},${a.y + (cy1 - a.y) * 0.5} ${b.x + (cx1 - b.x) * 0.5},${b.y + (cy1 - b.y) * 0.5} ${b.x},${b.y}`;
  }

  /**
   * Compute the minimum dim (opacity) across multiple element IDs.
   * Replaces verbose Math.min(ctx.dim('A'), ctx.dim('B'), ...) patterns.
   * @param {...string} ids - Element IDs
   * @returns {number} Minimum opacity (1 or 0.35)
   */
  _dimAll(...ids) {
    let m = 1;
    for (const id of ids) m = Math.min(m, this._dimFor(id));
    return m;
  }

  _phAttr(stepId, phaseNum, op) {
    const { show, anim, delay, effect } = this._ph(stepId, phaseNum);
    if (!show) return null;
    if (!anim) return `class="tds-fade" style="opacity:${op}"`;
    const effectClasses = {
      'appear': 'tds-phase-in',
      'draw': 'tds-draw-phase',
      'wipe-left': 'tds-wipe-left',
      'wipe-right': 'tds-wipe-right',
      'wipe-up': 'tds-wipe-up',
      'wipe-down': 'tds-wipe-down',
      'zoom': 'tds-zoom-in',
      'pop': 'tds-pop',
      'bounce': 'tds-bounce',
      'flip': 'tds-flip',
      'flip-up': 'tds-flip-up',
      'glow': 'tds-glow',
      'cascade': 'tds-cascade',
    };
    const cls = effectClasses[effect] || 'tds-phase-in';
    return `class="${cls}" style="opacity:${op};animation-delay:${delay}s"`;
  }

  /* Phase-wrapped group */
  _pw(stepId, phaseNum, op, svg) {
    const a = this._phAttr(stepId, phaseNum, op);
    if (!a) return '';
    const blur = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    return `<g ${a}${blur}>${svg}</g>`;
  }

  /* ── Focus / Spotlight ── */
  _getFocus() {
    if (this.step <= 0) return new Set();
    return new Set(this._steps[this.step - 1]?.focus || []);
  }

  _dimFor(tag) {
    const fs = this._getFocus();
    if (this.step <= 0 || fs.size === 0) return 1;
    return fs.has(tag) ? 1 : 0.35;
  }

  _isFocused(tag) {
    const fs = this._getFocus();
    return this.step <= 0 || fs.size === 0 || fs.has(tag);
  }

  _focusWrap(tag, haloId, svg) {
    if (!this._isFocused(tag)) return svg;
    // Use depth-lift filter for focused elements (Goal 2a: physical lift effect)
    const depthMap = {
      'tds-focus-halo-green': 'tds-depth-lift-green',
      'tds-focus-halo-blue': 'tds-depth-lift-blue',
      'tds-focus-halo-purple': 'tds-depth-lift-purple',
      'tds-focus-halo-gold': 'tds-depth-lift-gold',
    };
    const depthFilter = depthMap[haloId] || 'tds-depth-lift';
    // Apply both the halo and the depth-lift for maximum "floating" effect
    return `<g filter="url(#${haloId})"><g filter="url(#${depthFilter})">${svg}</g></g>`;
  }

  /* ── Position resolution ── */
  _pos(id) {
    if (this._graph) {
      const pos = this._graph.resolvePosition(id);
      if (pos) return pos;
    } else {
      const n = this._nodes.get(id);
      if (n) return { x: n.x, y: n.y };
      const a = this._anchors.get(id);
      if (a) return { x: a.x, y: a.y };
    }
    console.warn(`TopologyDesigner: unknown position id "${id}"`);
    return { x: 0, y: 0 };
  }

  /* ── Act helpers ── */
  _actFor(i) { return this._acts.find(a => i >= a.start && i < a.start + a.count); }
  _curAct()  { return this.step > 0 ? this._actFor(this.step - 1) : null; }
  _isActBound(n) { return this._acts.some(a => a.start === n - 1 && n - 1 !== 0); }

  /* ── Animated dot ── */
  _animDot(path, color, op = 1, dur = 2) {
    if (this.reducedMotion) return '';
    // On mobile, skip animated dots to reduce SVG complexity (#182)
    if (this._isMobile) return '';
    return `<circle r="3" fill="${color}" opacity="${0.8 * op}" filter="url(#tds-bloom)"><animateMotion dur="${dur}s" repeatCount="indefinite" path="${path}"/></circle>`;
  }

  /* ══════════════════════════════════════════
     SVG FILTER DEFINITIONS
     ══════════════════════════════════════════ */
  _svgDefs() {
    // On mobile Safari, use simplified filters to prevent GPU compositor crash (#182)
    if (this._isMobileSafari) return this._svgDefsMobile();
    return `<defs>
<pattern id="tds-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,.03)" stroke-width=".3"/></pattern>
<filter id="tds-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-strong" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-green" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feFlood flood-color="#01a982" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-blue" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feFlood flood-color="#65aef9" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-purple" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feFlood flood-color="#7764fc" flood-opacity=".18" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-red" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feFlood flood-color="#fc6161" flood-opacity=".25" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-gold" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feFlood flood-color="#deb146" flood-opacity=".15" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-dof-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.8"/></filter>
<filter id="tds-dof-blur-strong" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.8"/></filter>
<filter id="tds-focus-halo-green" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b"/><feFlood flood-color="#01a982" flood-opacity=".3" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-blue" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b"/><feFlood flood-color="#65aef9" flood-opacity=".25" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-purple" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feFlood flood-color="#7764fc" flood-opacity=".22" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-gold" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feFlood flood-color="#deb146" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<!-- Advanced Glow-Depth Filters (Goal 2a): focused nodes physically "lift" off canvas -->
<filter id="tds-depth-lift" x="-80%" y="-80%" width="260%" height="260%">
  <!-- Layer 1: Large soft shadow beneath (depth illusion) -->
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="shadow"/>
  <feOffset in="shadow" dx="0" dy="6" result="shadowOffset"/>
  <feFlood flood-color="#000" flood-opacity=".35" result="shadowColor"/>
  <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="dropShadow"/>
  <!-- Layer 2: Inner glow (rim light from above) -->
  <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="innerBlur"/>
  <feFlood flood-color="#fff" flood-opacity=".08" result="rimColor"/>
  <feComposite in="rimColor" in2="innerBlur" operator="in" result="rim"/>
  <!-- Layer 3: Outer colored bloom -->
  <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="bloom"/>
  <feColorMatrix in="bloom" type="saturate" values="1.8" result="saturatedBloom"/>
  <!-- Merge: shadow → saturated bloom → original → rim highlight -->
  <feMerge>
    <feMergeNode in="dropShadow"/>
    <feMergeNode in="saturatedBloom"/>
    <feMergeNode in="SourceGraphic"/>
    <feMergeNode in="rim"/>
  </feMerge>
</filter>
<filter id="tds-depth-lift-green" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="shadow"/>
  <feOffset in="shadow" dx="0" dy="6" result="shadowOffset"/>
  <feFlood flood-color="#000" flood-opacity=".35" result="shadowColor"/>
  <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="dropShadow"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="bloom"/>
  <feFlood flood-color="#01a982" flood-opacity=".25" result="glowColor"/>
  <feComposite in="glowColor" in2="bloom" operator="in" result="coloredGlow"/>
  <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="innerEdge"/>
  <feFlood flood-color="#01a982" flood-opacity=".12" result="edgeColor"/>
  <feComposite in="edgeColor" in2="innerEdge" operator="in" result="edge"/>
  <feMerge><feMergeNode in="dropShadow"/><feMergeNode in="coloredGlow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="edge"/></feMerge>
</filter>
<filter id="tds-depth-lift-blue" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="shadow"/>
  <feOffset in="shadow" dx="0" dy="6" result="shadowOffset"/>
  <feFlood flood-color="#000" flood-opacity=".35" result="shadowColor"/>
  <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="dropShadow"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="bloom"/>
  <feFlood flood-color="#65aef9" flood-opacity=".22" result="glowColor"/>
  <feComposite in="glowColor" in2="bloom" operator="in" result="coloredGlow"/>
  <feMerge><feMergeNode in="dropShadow"/><feMergeNode in="coloredGlow"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="tds-depth-lift-purple" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="shadow"/>
  <feOffset in="shadow" dx="0" dy="6" result="shadowOffset"/>
  <feFlood flood-color="#000" flood-opacity=".35" result="shadowColor"/>
  <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="dropShadow"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="bloom"/>
  <feFlood flood-color="#7764fc" flood-opacity=".2" result="glowColor"/>
  <feComposite in="glowColor" in2="bloom" operator="in" result="coloredGlow"/>
  <feMerge><feMergeNode in="dropShadow"/><feMergeNode in="coloredGlow"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="tds-depth-lift-gold" x="-80%" y="-80%" width="260%" height="260%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="shadow"/>
  <feOffset in="shadow" dx="0" dy="6" result="shadowOffset"/>
  <feFlood flood-color="#000" flood-opacity=".35" result="shadowColor"/>
  <feComposite in="shadowColor" in2="shadowOffset" operator="in" result="dropShadow"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="bloom"/>
  <feFlood flood-color="#deb146" flood-opacity=".18" result="glowColor"/>
  <feComposite in="glowColor" in2="bloom" operator="in" result="coloredGlow"/>
  <feMerge><feMergeNode in="dropShadow"/><feMergeNode in="coloredGlow"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<!-- Enhanced unfocus: stronger blur + desaturate for cinematic DOF -->
<filter id="tds-dof-cinematic" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur stdDeviation="2.5" result="blur"/>
  <feColorMatrix in="blur" type="saturate" values="0.4"/>
</filter>
<!-- Temporal Digital Twin Filters -->
<filter id="tds-temporal-jitter" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="2" seed="1" result="turb">
    <animate attributeName="baseFrequency" values="0.04;0.06;0.04" dur="0.8s" repeatCount="indefinite"/>
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="turb" scale="3" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="tds-temporal-down" x="-20%" y="-20%" width="140%" height="140%">
  <feColorMatrix type="saturate" values="0.1" result="desat"/>
  <feGaussianBlur in="desat" stdDeviation="1.5" result="blur"/>
  <feFlood flood-color="#fc6161" flood-opacity=".15" result="tint"/>
  <feComposite in="tint" in2="blur" operator="in" result="tinted"/>
  <feMerge><feMergeNode in="tinted"/><feMergeNode in="blur"/></feMerge>
</filter>
<filter id="tds-temporal-breach" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
  <feFlood flood-color="#fc6161" flood-opacity=".3" result="red"/>
  <feComposite in="red" in2="blur" operator="in" result="redGlow"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="3" result="noise">
    <animate attributeName="seed" values="1;10;1" dur="0.3s" repeatCount="indefinite"/>
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" result="displaced"/>
  <feMerge><feMergeNode in="redGlow"/><feMergeNode in="displaced"/></feMerge>
</filter>
<!-- Neon Glow-Stack Filter (Advanced Visual Fidelity) -->
<filter id="tds-neon-glow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="2" result="innerGlow"/>
  <feGaussianBlur stdDeviation="6" result="outerGlow"/>
  <feGaussianBlur stdDeviation="12" result="farGlow"/>
  <feColorMatrix in="outerGlow" type="saturate" values="2.5" result="saturatedOuter"/>
  <feColorMatrix in="farGlow" type="saturate" values="1.8" result="saturatedFar"/>
  <feMerge>
    <feMergeNode in="saturatedFar"/>
    <feMergeNode in="saturatedOuter"/>
    <feMergeNode in="innerGlow"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>
<!-- Ghosting filter: desaturate + subtle scale -->
<filter id="tds-ghost" x="-10%" y="-10%" width="120%" height="120%">
  <feColorMatrix type="saturate" values="0.15" result="desat"/>
  <feGaussianBlur in="desat" stdDeviation="0.8"/>
</filter>
<!-- Blast Radius ring -->
<filter id="tds-blast-ring" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="4" result="blur"/>
  <feFlood flood-color="#fc6161" flood-opacity=".15" result="red"/>
  <feComposite in="red" in2="blur" operator="in" result="glow"/>
  <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<!-- Tunnel multi-scale bloom (approximates UnrealBloom scene-wide light bleed) -->
<filter id="tds-tunnel-bloom" x="-100%" y="-100%" width="300%" height="300%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b1"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="b2"/>
  <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="b3"/>
  <feBlend in="b1" in2="b2" mode="screen" result="s12"/>
  <feBlend in="s12" in2="b3" mode="screen" result="bloom"/>
  <feBlend in="SourceGraphic" in2="bloom" mode="screen"/>
</filter>
<!-- Tunnel tube illusion (cylindrical volume via diffuse lighting) -->
<filter id="tds-tunnel-tube" x="-40%" y="-100%" width="180%" height="300%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="bump"/>
  <feDiffuseLighting in="bump" surfaceScale="8" diffuseConstant="1.2" lighting-color="#fff" result="diffuse">
    <feDistantLight azimuth="225" elevation="55"/>
  </feDiffuseLighting>
  <feComposite in="diffuse" in2="SourceAlpha" operator="in" result="lit"/>
  <feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="0" k2="1" k3="0.4" k4="0"/>
</filter>
<!-- Tunnel filmic color grading (ACES-like tone mapping approximation) -->
<filter id="tds-tunnel-filmic" x="-100%" y="-100%" width="300%" height="300%">
  <feComponentTransfer>
    <feFuncR type="gamma" amplitude="1.1" exponent="0.92" offset="0.02"/>
    <feFuncG type="gamma" amplitude="1.1" exponent="0.92" offset="0.02"/>
    <feFuncB type="gamma" amplitude="1.15" exponent="0.88" offset="0.03"/>
  </feComponentTransfer>
</filter>
<linearGradient id="tds-labelGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(34,37,46,.92)"/><stop offset="100%" stop-color="rgba(29,31,39,.88)"/></linearGradient>
<radialGradient id="tds-ambientGreen" cx="20%" cy="35%" r="35%"><stop offset="0%" stop-color="rgba(1,169,130,.07)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-ambientPurple" cx="80%" cy="70%" r="30%"><stop offset="0%" stop-color="rgba(119,100,252,.05)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-ambientBlue" cx="55%" cy="10%" r="25%"><stop offset="0%" stop-color="rgba(101,174,249,.04)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-vignette" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="transparent"/><stop offset="65%" stop-color="rgba(5,8,22,.06)"/><stop offset="100%" stop-color="rgba(5,8,22,.3)"/></radialGradient>
</defs>`;
  }

  /** Simplified SVG defs for mobile Safari — fewer filter stages, smaller blur radii (#182) */
  _svgDefsMobile() {
    return `<defs>
<pattern id="tds-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,.03)" stroke-width=".3"/></pattern>
<filter id="tds-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-strong" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-green" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feFlood flood-color="#01a982" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-blue" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feFlood flood-color="#65aef9" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-purple" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feFlood flood-color="#7764fc" flood-opacity=".18" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-red" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feFlood flood-color="#fc6161" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-glow-gold" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feFlood flood-color="#deb146" flood-opacity=".15" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-dof-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>
<filter id="tds-dof-blur-strong" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter>
<!-- Mobile: simplified focus halos (no multi-stage depth lift) -->
<filter id="tds-focus-halo-green" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feFlood flood-color="#01a982" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-blue" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feFlood flood-color="#65aef9" flood-opacity=".2" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-purple" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feFlood flood-color="#7764fc" flood-opacity=".18" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-focus-halo-gold" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/><feFlood flood-color="#deb146" flood-opacity=".15" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<!-- Mobile: depth-lift aliases point to simple halos -->
<filter id="tds-depth-lift"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-depth-lift-green"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feFlood flood-color="#01a982" flood-opacity=".15" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-depth-lift-blue"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feFlood flood-color="#65aef9" flood-opacity=".15" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-depth-lift-purple"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feFlood flood-color="#7764fc" flood-opacity=".12" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-depth-lift-gold"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feFlood flood-color="#deb146" flood-opacity=".12" result="c"/><feComposite in="c" in2="b" operator="in" result="d"/><feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-dof-cinematic" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.8"/></filter>
<filter id="tds-temporal-jitter" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1"/></filter>
<filter id="tds-temporal-down" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="saturate" values="0.2"/></filter>
<filter id="tds-temporal-breach" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="saturate" values="0.3"/></filter>
<filter id="tds-neon-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="tds-ghost" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="saturate" values="0.2"/></filter>
<filter id="tds-blast-ring" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="tds-labelGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(34,37,46,.92)"/><stop offset="100%" stop-color="rgba(29,31,39,.88)"/></linearGradient>
<radialGradient id="tds-ambientGreen" cx="20%" cy="35%" r="35%"><stop offset="0%" stop-color="rgba(1,169,130,.07)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-ambientPurple" cx="80%" cy="70%" r="30%"><stop offset="0%" stop-color="rgba(119,100,252,.05)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-ambientBlue" cx="55%" cy="10%" r="25%"><stop offset="0%" stop-color="rgba(101,174,249,.04)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
<radialGradient id="tds-vignette" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="transparent"/><stop offset="100%" stop-color="rgba(0,0,0,.25)"/></radialGradient>
</defs>`;
  }

  _svgAmbient(w, h) {
    // On mobile Safari, skip heavy ambient effects to prevent blank page (#182)
    if (this._isMobileSafari) {
      return `<rect width="${w}" height="${h}" fill="url(#tds-ambientGreen)" opacity=".3"/>
<rect width="${w}" height="${h}" fill="url(#tds-vignette)" opacity=".3"/>
<rect width="${w}" height="${h}" fill="url(#tds-grid)"/>`;
    }

    let ambient = `
<rect width="${w}" height="${h}" fill="url(#tds-ambientGreen)"><animate attributeName="opacity" values=".5;.8;.5" dur="12s" repeatCount="indefinite"/></rect>
<rect width="${w}" height="${h}" fill="url(#tds-ambientPurple)"><animate attributeName="opacity" values=".4;.7;.4" dur="16s" repeatCount="indefinite"/></rect>
<rect width="${w}" height="${h}" fill="url(#tds-ambientBlue)"><animate attributeName="opacity" values=".3;.6;.3" dur="10s" repeatCount="indefinite"/></rect>
<rect width="${w}" height="${h}" fill="url(#tds-vignette)" opacity=".4"/>
<rect width="${w}" height="${h}" fill="url(#tds-grid)"/>`;

    // On mobile, skip data bits + radar pulse + scan lines to reduce SVG element count
    if (this._isMobile) return ambient;

    // ── Ambient Enhancement 1: Scanning Grid Lines (Goal 2c) ──
    // Horizontal and vertical scan lines that slowly sweep across the canvas
    if (!this.reducedMotion) {
      ambient += `<g opacity=".08">
<line x1="0" y1="0" x2="${w}" y2="0" stroke="#01a982" stroke-width=".5">
  <animateTransform attributeName="transform" type="translate" values="0,0;0,${h};0,0" dur="18s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0;.5;0" dur="18s" repeatCount="indefinite"/>
</line>
<line x1="0" y1="0" x2="0" y2="${h}" stroke="#65aef9" stroke-width=".5">
  <animateTransform attributeName="transform" type="translate" values="0,0;${w},0;0,0" dur="24s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0;.4;0" dur="24s" repeatCount="indefinite"/>
</line>
</g>`;

      // ── Ambient Enhancement 2: Floating Data Bits ──
      // Tiny characters that drift upward like data particles
      const bits = ['0', '1', '0', '1', '0', '1', '01', '10'];
      for (let i = 0; i < 8; i++) {
        const bx = (w * 0.1) + (i * w * 0.1);
        const bDur = 12 + (i % 3) * 4;
        const bDelay = i * 1.5;
        ambient += `<text x="${bx}" y="${h}" fill="#01a982" font-size="6" opacity="0" font-family="var(--tds-font)">
  ${bits[i]}
  <animateTransform attributeName="transform" type="translate" values="0,0;${(i%2?5:-5)},${-h*0.8}" dur="${bDur}s" begin="${bDelay}s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0;.12;.08;0" dur="${bDur}s" begin="${bDelay}s" repeatCount="indefinite"/>
</text>`;
      }

      // ── Ambient Enhancement 3: Pulse Ring Radar ──
      // Concentric circles that expand from canvas center like a radar ping
      const cx = w / 2, cy = h / 2;
      ambient += `<g opacity=".06">
<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="#01a982" stroke-width=".5">
  <animate attributeName="r" values="10;${Math.min(w,h)*0.45}" dur="8s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values=".3;0" dur="8s" repeatCount="indefinite"/>
</circle>
<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="#7764fc" stroke-width=".4">
  <animate attributeName="r" values="10;${Math.min(w,h)*0.35}" dur="8s" begin="4s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values=".2;0" dur="8s" begin="4s" repeatCount="indefinite"/>
</circle>
</g>`;
    }

    return ambient;
  }

  /* ══════════════════════════════════════════
     NODE RENDERERS
     Each returns raw SVG string for a node type
     ══════════════════════════════════════════ */

  /** EdgeConnect appliance
   *  cfg.variant: 'generic'|'virtual'|'physical'|'aws'|'azure'|'gcp'|'oracle' (default: 'generic')
   */
  static renderEC(x, y, cfg = {}) {
    const variant = cfg.variant || 'generic';
    const variantStyles = {
      generic:  { color: '#01a982', glow: 'tds-glow-green', badge: null },
      virtual:  { color: '#7764fc', glow: 'tds-glow-purple', badge: 'VM' },
      physical: { color: '#01a982', glow: 'tds-glow-green', badge: 'HW' },
      aws:      { color: '#ec8c25', glow: 'tds-glow-gold',  badge: 'AWS' },
      azure:    { color: '#0078d4', glow: 'tds-glow-blue',  badge: 'AZ' },
      gcp:      { color: '#4285f4', glow: 'tds-glow-blue',  badge: 'GCP' },
      oracle:   { color: '#f80000', glow: 'tds-glow-red',   badge: 'OCI' },
    };
    const vs = variantStyles[variant] || variantStyles.generic;
    const c = cfg.color || vs.color;
    const gf = cfg.color ? TopologyDesigner._glowForColorStatic(cfg.color) : vs.glow;

    let s = `<ellipse cx="${x}" cy="${y}" rx="36" ry="20" fill="${c}" opacity=".06" filter="url(#${gf})"/>`;

    // VRRP state determines LED colors
    const vrrp = cfg.vrrpState; // 'active' | 'standby' | null
    const led1 = vrrp === 'standby' ? '#deb146' : '#05cc93';
    const led2 = vrrp === 'standby' ? '#535c66' : '#05cc93';
    const ledFilter = vrrp === 'standby' ? '' : 'filter="url(#tds-bloom)"';
    const ledOp1 = vrrp === 'standby' ? '.7' : '1';
    const ledOp2 = vrrp === 'standby' ? '.4' : '1';

    if (variant === 'physical') {
      // Physical: wider chassis with ventilation slits
      s += `<rect x="${x-32}" y="${y-16}" width="64" height="32" rx="3" fill="#292d3a" stroke="${c}" stroke-width="1.5"/>`;
      s += `<rect x="${x-31}" y="${y-15}" width="62" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
      // Ventilation slits
      for (let i = 0; i < 4; i++) {
        s += `<line x1="${x+10+i*5}" y1="${y-10}" x2="${x+10+i*5}" y2="${y-4}" stroke="${c}" stroke-width=".4" opacity=".3"/>`;
      }
      // Triangle logo
      s += `<polygon points="${x-8},${y-8} ${x-17},${y+6} ${x+1},${y+6}" fill="none" stroke="${c}" stroke-width="1.2" filter="url(#tds-glow)"/>`;
      // Power + status LEDs (VRRP-aware)
      s += `<circle cx="${x-22}" cy="${y-8}" r="2.2" fill="${led1}" opacity="${ledOp1}" ${ledFilter}/>`;
      s += `<circle cx="${x-22}" cy="${y-2}" r="2.2" fill="${led2}" opacity="${ledOp2}" ${ledFilter}/>`;
      s += `<circle cx="${x+16}" cy="${y+9}" r="1.8" fill="#ec8c25" opacity=".6"/>`;
      s += `<circle cx="${x+21}" cy="${y+9}" r="1.8" fill="${c}" opacity=".6"/>`;
      // VRRP active badge — pulsing glow
      if (vrrp === 'active') {
        s += `<circle cx="${x-22}" cy="${y-5}" r="6" fill="#05cc93" opacity=".15"><animate attributeName="opacity" values=".15;.3;.15" dur="2s" repeatCount="indefinite"/></circle>`;
      }
      // VRRP vertical label next to LEDs
      if (vrrp) {
        const vrrpColor = vrrp === 'active' ? '#05cc93' : '#deb146';
        s += `<text x="${x-27}" y="${y-9}" fill="${vrrpColor}" font-size="4" font-weight="700" letter-spacing="1.5" opacity=".7" writing-mode="vertical-rl">VRRP</text>`;
      }
      // Rack ears
      s += `<rect x="${x-35}" y="${y-12}" width="3" height="24" rx="1" fill="#1d1f27" stroke="${c}" stroke-width=".5" opacity=".5"/>`;
      s += `<rect x="${x+32}" y="${y-12}" width="3" height="24" rx="1" fill="#1d1f27" stroke="${c}" stroke-width=".5" opacity=".5"/>`;
    } else {
      // All other variants: standard EC body
      s += `<rect x="${x-30}" y="${y-15}" width="60" height="30" rx="5" fill="#292d3a" stroke="${c}" stroke-width="1.3"/>`;
      s += `<rect x="${x-29}" y="${y-14}" width="58" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
      s += `<polygon points="${x},${y-8} ${x-9},${y+6} ${x+9},${y+6}" fill="none" stroke="${c}" stroke-width="1.2" filter="url(#tds-glow)"/>`;
      // Status LEDs (VRRP-aware)
      s += `<circle cx="${x-19}" cy="${y-7}" r="2.2" fill="${led1}" opacity="${ledOp1}" ${ledFilter}/>`;
      s += `<circle cx="${x-13}" cy="${y-7}" r="2.2" fill="${led2}" opacity="${ledOp2}" ${ledFilter}/>`;
      s += `<circle cx="${x+13}" cy="${y+8}" r="1.8" fill="#ec8c25" opacity=".6"/>`;
      s += `<circle cx="${x+18}" cy="${y+8}" r="1.8" fill="${c}" opacity=".6"/>`;
      // VRRP active badge — pulsing glow
      if (vrrp === 'active') {
        s += `<circle cx="${x-16}" cy="${y-7}" r="8" fill="#05cc93" opacity=".12"><animate attributeName="opacity" values=".12;.25;.12" dur="2s" repeatCount="indefinite"/></circle>`;
      }
      // VRRP vertical label below LEDs
      if (vrrp) {
        const vrrpColor = vrrp === 'active' ? '#05cc93' : '#deb146';
        s += `<text x="${x-22}" y="${y-8}" fill="${vrrpColor}" font-size="4" font-weight="700" letter-spacing="1.5" opacity=".7" writing-mode="vertical-rl">VRRP</text>`;
      }
    }

    // Cloud provider icons for AWS/Azure/GCP/Oracle
    if (variant === 'aws') {
      // AWS smile arrow
      s += `<path d="M${x+15},${y-10} Q${x+20},${y-6} ${x+25},${y-10}" fill="none" stroke="#ec8c25" stroke-width="1.2" opacity=".8"/>`;
      s += `<polygon points="${x+24},${y-12} ${x+26},${y-10} ${x+24},${y-8}" fill="#ec8c25" opacity=".8"/>`;
    } else if (variant === 'azure') {
      // Azure parallelogram
      s += `<path d="M${x+14},${y-10} L${x+24},${y-10} L${x+20},${y-2} L${x+10},${y-2}Z" fill="none" stroke="#0078d4" stroke-width=".9" opacity=".8"/>`;
    } else if (variant === 'gcp') {
      // GCP hexagon
      const hx = x+19, hy = y-6, hr = 6;
      s += `<polygon points="${[0,1,2,3,4,5].map(i => {const a=i*Math.PI/3-Math.PI/6; return `${hx+Math.cos(a)*hr},${hy+Math.sin(a)*hr}`;}).join(' ')}" fill="none" stroke="#4285f4" stroke-width=".9" opacity=".8"/>`;
    } else if (variant === 'oracle') {
      // Oracle "O" ring
      s += `<circle cx="${x+20}" cy="${y-6}" r="5" fill="none" stroke="#f80000" stroke-width="1.2" opacity=".8"/>`;
    } else if (variant === 'virtual') {
      // VM dashed box overlay
      s += `<rect x="${x+14}" y="${y-12}" width="14" height="10" rx="2" fill="none" stroke="#7764fc" stroke-width=".8" stroke-dasharray="2 1" opacity=".7"/>`;
      s += `<rect x="${x+16}" y="${y-10}" width="10" height="6" rx="1" fill="#7764fc" opacity=".15"/>`;
    }

    // Variant badge
    if (vs.badge) {
      s += `<rect x="${x-30}" y="${y-25}" width="${vs.badge.length * 7 + 6}" height="12" rx="3" fill="${c}" opacity=".15" stroke="${c}" stroke-width=".5"/>`;
      s += `<text x="${x-27}" y="${y-16}" fill="${c}" font-size="7" font-weight="700" letter-spacing=".5">${vs.badge}</text>`;
    }

    return s;
  }

  /** Network switch */
  static renderSwitch(x, y, cfg = {}) {
    let s = `<ellipse cx="${x}" cy="${y}" rx="38" ry="18" fill="#00a4b3" opacity=".04" filter="url(#tds-glow)"/>` +
      `<rect x="${x-32}" y="${y-13}" width="64" height="26" rx="3" fill="#22252e" stroke="#00a4b3" stroke-width=".9"/>` +
      `<rect x="${x-31}" y="${y-12}" width="62" height="1" rx=".5" fill="rgba(255,255,255,.03)"/>`;
    for (let i = 0; i < 8; i++) {
      const px = x - 26 + i * 7.5;
      s += `<rect x="${px}" y="${y-8}" width="4" height="5" rx=".6" fill="${i<4?'#05cc93':'#00a4b3'}" opacity="${i<4?'.55':'.3'}"${i<4?' filter="url(#tds-bloom)"':''}/>`;
    }
    s += `<line x1="${x-26}" y1="${y+4}" x2="${x+26}" y2="${y+4}" stroke="#00a4b3" stroke-width=".4" opacity=".2"/>`;
    return s;
  }

  /** Enterprise switch — detailed chassis with copper (RJ45) and fiber (SFP) ports */
  static renderSwitchEnterprise(x, y, cfg = {}) {
    const c = cfg.color || '#00a4b3';
    const gf = TopologyDesigner._glowForColorStatic(c);
    const copperPorts = cfg.copperPorts || 8;
    const fiberPorts = cfg.fiberPorts || 2;

    // Wider chassis
    let s = `<ellipse cx="${x}" cy="${y}" rx="52" ry="22" fill="${c}" opacity=".04" filter="url(#${gf})"/>`;
    s += `<rect x="${x-44}" y="${y-16}" width="88" height="32" rx="3" fill="#22252e" stroke="${c}" stroke-width="1.1"/>`;
    s += `<rect x="${x-43}" y="${y-15}" width="86" height="1" rx=".5" fill="rgba(255,255,255,.03)"/>`;

    // Status LEDs (top-left)
    s += `<circle cx="${x-36}" cy="${y-9}" r="1.8" fill="#05cc93" filter="url(#tds-bloom)"/>`;
    s += `<circle cx="${x-31}" cy="${y-9}" r="1.8" fill="${c}" opacity=".6"/>`;
    s += `<circle cx="${x-26}" cy="${y-9}" r="1.2" fill="#ec8c25" opacity=".5"/>`;

    // Copper ports (RJ45 style) — bottom row, rectangular with small tab
    const copperStartX = x - 38;
    const copperY = y + 1;
    for (let i = 0; i < copperPorts; i++) {
      const px = copperStartX + i * 8;
      const active = i < Math.ceil(copperPorts * 0.6); // 60% active
      s += `<rect x="${px}" y="${copperY}" width="5.5" height="7" rx=".5" fill="${active ? '#093d32' : '#1d1f27'}" stroke="${active ? '#05cc93' : c}" stroke-width="${active ? '.6' : '.4'}" opacity="${active ? 1 : .5}"/>`;
      // RJ45 tab detail
      s += `<rect x="${px+1}" y="${copperY}" width="3.5" height="1.5" rx=".3" fill="${active ? '#05cc93' : c}" opacity="${active ? '.3' : '.15'}"/>`;
      // Activity LED
      if (active) {
        s += `<circle cx="${px+2.75}" cy="${copperY+9}" r=".8" fill="#05cc93" opacity=".7"/>`;
      }
    }

    // Fiber ports (SFP style) — top row, taller/narrower with different color
    const fiberStartX = x + 44 - (fiberPorts * 10) - 4;
    const fiberY = y - 12;
    for (let i = 0; i < fiberPorts; i++) {
      const px = fiberStartX + i * 10;
      const active = i < Math.ceil(fiberPorts * 0.5);
      // SFP cage
      s += `<rect x="${px}" y="${fiberY}" width="7" height="10" rx="1" fill="${active ? '#1a1a3a' : '#1d1f27'}" stroke="${active ? '#65aef9' : c}" stroke-width="${active ? '.7' : '.4'}" opacity="${active ? 1 : .5}"/>`;
      // Fiber connectors (two dots for TX/RX)
      s += `<circle cx="${px+2.5}" cy="${fiberY+4}" r="1" fill="${active ? '#65aef9' : c}" opacity="${active ? '.8' : '.3'}"/>`;
      s += `<circle cx="${px+4.5}" cy="${fiberY+4}" r="1" fill="${active ? '#65aef9' : c}" opacity="${active ? '.8' : '.3'}"/>`;
      if (active) {
        s += `<circle cx="${px+3.5}" cy="${fiberY+8}" r=".8" fill="#65aef9" opacity=".6" filter="url(#tds-bloom)"/>`;
      }
    }

    // Divider line between port sections
    s += `<line x1="${x-40}" y1="${y-1}" x2="${x+40}" y2="${y-1}" stroke="${c}" stroke-width=".3" opacity=".2"/>`;

    // Console port (small, right side)
    s += `<rect x="${x+34}" y="${y+2}" width="6" height="5" rx="1" fill="#1d1f27" stroke="#65aef9" stroke-width=".4" opacity=".6"/>`;
    s += `<text x="${x+37}" y="${y+6}" text-anchor="middle" fill="#65aef9" font-size="3" opacity=".5">C</text>`;

    return s;
  }

  /** Cloud service
   *  cfg.innerClouds: 'both' (default) | 'left' | 'right' | 'none' — controls inner cloud puffs
   */
  static renderCloud(x, y, cfg = {}) {
    const { label = '', color = '#01a982', sub1 = '', sub2 = '', innerClouds = 'both' } = cfg;
    const ty = sub1 ? y - 2 : y + 4;
    const gfMap = { '#01a982':'tds-glow-green', '#068667':'tds-glow-green', '#7764fc':'tds-glow-purple', '#65aef9':'tds-glow-blue' };
    const gf = gfMap[color] || 'tds-glow';
    let s = `<ellipse cx="${x}" cy="${y}" rx="70" ry="40" fill="${color}" opacity=".04" filter="url(#${gf})"/>` +
      `<ellipse cx="${x}" cy="${y}" rx="62" ry="34" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.5"/>`;
    if (innerClouds === 'both' || innerClouds === 'left') {
      s += `<ellipse cx="${x-22}" cy="${y-10}" rx="24" ry="17" fill="${color}" opacity=".07"/>`;
    }
    if (innerClouds === 'both' || innerClouds === 'right') {
      s += `<ellipse cx="${x+24}" cy="${y-7}" rx="21" ry="15" fill="${color}" opacity=".07"/>`;
    }
    s += `<text x="${x}" y="${ty}" text-anchor="middle" fill="${color}" font-size="12" font-weight="600" filter="url(#tds-glow)">${_esc(label)}</text>` +
      (sub1 ? `<text x="${x}" y="${y+13}" text-anchor="middle" fill="${color}" font-size="8.5" opacity=".7">${_esc(sub1)}</text>` : '') +
      (sub2 ? `<text x="${x}" y="${y+24}" text-anchor="middle" fill="${color}" font-size="7.5" opacity=".5">${_esc(sub2)}</text>` : '');
    return s;
  }

  /** Host / laptop */
  static renderHost(x, y, cfg = {}) {
    const { managed = false, agent = false, color } = cfg;
    // Allow custom color override; falls back to managed/default palette
    const baseColor = color || (managed ? '#05cc93' : '#7d8a92');
    const iconColor = color || (managed ? '#05cc93' : '#01a982');
    const screenFill = managed ? '#093d32' : '#1d1f27';
    const glowFilter = color ? `url(#${TopologyDesigner._glowForColorStatic(color)})` : 'url(#tds-glow-green)';
    let s = '';
    if (managed || color) s += `<ellipse cx="${x}" cy="${y}" rx="28" ry="22" fill="${baseColor}" opacity=".05" filter="${glowFilter}"/>`;
    s += `<rect x="${x-20}" y="${y-15}" width="40" height="24" rx="2" fill="#292d3a" stroke="${baseColor}" stroke-width="1.1"/>` +
      `<rect x="${x-19}" y="${y-14}" width="38" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
      `<rect x="${x-17}" y="${y-12}" width="34" height="18" rx="1" fill="${screenFill}"/>` +
      `<path d="M${x-24},${y+9} L${x-20},${y+9} L${x-18},${y+13} L${x+18},${y+13} L${x+20},${y+9} L${x+24},${y+9}" fill="#292d3a" stroke="${baseColor}" stroke-width=".8"/>` +
      `<circle cx="${x}" cy="${y-5}" r="3.5" fill="none" stroke="${iconColor}" stroke-width=".9"/>` +
      `<path d="M${x-6},${y+4} Q${x},${y} ${x+6},${y+4}" fill="none" stroke="${iconColor}" stroke-width=".9"/>`;
    if (managed) {
      const badgeColor = color || '#05cc93';
      s += `<circle cx="${x+16}" cy="${y-13}" r="7" fill="#1d1f27" stroke="${badgeColor}" stroke-width=".9" filter="url(#tds-bloom)"/>` +
        `<path d="M${x+13},${y-14} L${x+16},${y-17} L${x+19},${y-14} L${x+19},${y-10} Q${x+16},${y-8} ${x+13},${y-10}Z" fill="${badgeColor}" opacity=".6"/>`;
    }
    if (agent) {
      const agentColor = cfg.agentColor || '#65aef9';
      const agentGlow = TopologyDesigner._glowForColorStatic(agentColor);
      const ax = x - 20, ay = y - 20;
      s += `<circle cx="${ax}" cy="${ay}" r="9" fill="#1d1f27" stroke="${agentColor}" stroke-width=".9" filter="url(#${agentGlow})"/>`;
      for (let i = 0; i < 6; i++) {
        const ang = i * Math.PI / 3 - Math.PI / 2;
        const tx = ax + Math.cos(ang) * 6, ty = ay + Math.sin(ang) * 6;
        s += `<line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty}" stroke="${agentColor}" stroke-width=".9" opacity=".8"/>` +
          `<circle cx="${tx}" cy="${ty}" r="1.2" fill="${agentColor}" opacity=".8"/>`;
      }
      s += `<circle cx="${ax}" cy="${ay}" r="1.5" fill="${agentColor}" filter="url(#tds-bloom)"/>`;
    }
    return s;
  }

  /** Static helper for glow filter lookup (used by static renderers) */
  static _glowForColorStatic(c) {
    const map = { '#01a982':'tds-glow-green', '#068667':'tds-glow-green', '#05cc93':'tds-glow-green',
      '#65aef9':'tds-glow-blue', '#7764fc':'tds-glow-purple', '#deb146':'tds-glow-gold',
      '#fc6161':'tds-glow-red', '#d25f4b':'tds-glow', '#b1b9be':'tds-glow' };
    return map[c] || 'tds-glow';
  }

  /** Connector / PEP */
  static renderConnector(x, y, cfg = {}) {
    const { pe = false } = cfg;
    const c = pe ? '#068667' : '#65aef9', gf = pe ? 'tds-glow-green' : 'tds-glow-blue';
    const cx = x, cy = y - 2;
    const n1x = cx - 8, n1y = cy - 7, n2x = cx + 8, n2y = cy - 7, n3x = cx, n3y = cy + 8;
    let s = `<ellipse cx="${x}" cy="${y}" rx="28" ry="22" fill="${c}" opacity=".05" filter="url(#${gf})"/>` +
      `<rect x="${x-22}" y="${y-15}" width="44" height="30" rx="5" fill="#292d3a" stroke="${c}" stroke-width="${pe?1.6:1.1}"/>` +
      `<rect x="${x-21}" y="${y-14}" width="42" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
      `<line x1="${cx}" y1="${cy}" x2="${n1x}" y2="${n1y}" stroke="${c}" stroke-width="1.2" opacity=".7"/>` +
      `<line x1="${cx}" y1="${cy}" x2="${n2x}" y2="${n2y}" stroke="${c}" stroke-width="1.2" opacity=".7"/>` +
      `<line x1="${cx}" y1="${cy}" x2="${n3x}" y2="${n3y}" stroke="${c}" stroke-width="1.2" opacity=".7"/>` +
      `<circle cx="${cx}" cy="${cy}" r="3.2" fill="#292d3a" stroke="${c}" stroke-width="1.2" filter="url(#tds-glow)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${c}" opacity=".8" filter="url(#tds-bloom)"/>` +
      `<circle cx="${n1x}" cy="${n1y}" r="2.2" fill="#292d3a" stroke="${c}" stroke-width="1"/><circle cx="${n1x}" cy="${n1y}" r="1" fill="${c}" opacity=".6"/>` +
      `<circle cx="${n2x}" cy="${n2y}" r="2.2" fill="#292d3a" stroke="${c}" stroke-width="1"/><circle cx="${n2x}" cy="${n2y}" r="1" fill="${c}" opacity=".6"/>` +
      `<circle cx="${n3x}" cy="${n3y}" r="2.2" fill="#292d3a" stroke="${c}" stroke-width="1"/><circle cx="${n3x}" cy="${n3y}" r="1" fill="${c}" opacity=".6"/>`;
    if (pe) {
      s += `<rect x="${x-20}" y="${y-30}" width="40" height="14" rx="4" fill="#068667" opacity=".15" stroke="#068667" stroke-width=".7"/>` +
        `<text x="${x}" y="${y-20}" text-anchor="middle" fill="#068667" font-size="6.5" font-weight="700">PRIVATE EDGE</text>`;
    }
    return s;
  }

  /** Private apps rack */
  static renderApps(x, y, cfg = {}) {
    return `<ellipse cx="${x}" cy="${y}" rx="24" ry="28" fill="#deb146" opacity=".04" filter="url(#tds-glow-gold)"/>` +
      `<rect x="${x-18}" y="${y-22}" width="36" height="44" rx="3" fill="#292d3a" stroke="#deb146" stroke-width=".9"/>` +
      `<rect x="${x-17}" y="${y-21}" width="34" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
      `<rect x="${x-14}" y="${y-18}" width="28" height="9" rx="1" fill="#22252e" stroke="#deb146" stroke-width=".4"/>` +
      `<rect x="${x-14}" y="${y-6}" width="28" height="9" rx="1" fill="#22252e" stroke="#deb146" stroke-width=".4"/>` +
      `<rect x="${x-14}" y="${y+6}" width="28" height="9" rx="1" fill="#22252e" stroke="#deb146" stroke-width=".4"/>` +
      `<circle cx="${x-9}" cy="${y-13}" r="1.4" fill="#05cc93" filter="url(#tds-bloom)"/>` +
      `<circle cx="${x-9}" cy="${y-1}" r="1.4" fill="#05cc93" filter="url(#tds-bloom)"/>` +
      `<circle cx="${x-9}" cy="${y+11}" r="1.4" fill="#deb146" filter="url(#tds-bloom)"/>`;
  }

  /** SaaS cloud */
  static renderSaaS(x, y, cfg = {}) {
    const c = cfg.color || '#d25f4b';
    let svg = `<ellipse cx="${x}" cy="${y}" rx="42" ry="26" fill="${c}" opacity=".04" filter="url(#tds-glow)"/>` +
      `<ellipse cx="${x}" cy="${y-4}" rx="34" ry="20" fill="${c}" opacity=".08" stroke="${c}" stroke-width="1"/>` +
      `<ellipse cx="${x-14}" cy="${y-11}" rx="16" ry="11" fill="${c}" opacity=".05"/>` +
      `<ellipse cx="${x+16}" cy="${y-9}" rx="14" ry="10" fill="${c}" opacity=".05"/>`;
    // Logo image takes priority over default icon squares
    if (cfg.logoUrl) {
      svg += `<image href="${cfg.logoUrl}" x="${x-14}" y="${y-12}" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>`;
    } else {
      // Default: four colored squares (icon grid)
      svg += `<rect x="${x-16}" y="${y-11}" width="9" height="9" rx="2" fill="${c}" opacity=".7"/>` +
        `<rect x="${x-4}" y="${y-11}" width="9" height="9" rx="2" fill="${c}" opacity=".5"/>` +
        `<rect x="${x-10}" y="${y-1}" width="9" height="9" rx="2" fill="${c}" opacity=".4"/>` +
        `<rect x="${x+2}" y="${y-1}" width="9" height="9" rx="2" fill="${c}" opacity=".6"/>`;
    }
    return svg;
  }

  /** Server rack */
  static renderServer(x, y, cfg = {}) {
    const c = cfg.color || '#01a982';
    return `<ellipse cx="${x}" cy="${y}" rx="26" ry="24" fill="${c}" opacity=".04" filter="url(#tds-glow)"/>` +
      `<rect x="${x-20}" y="${y-20}" width="40" height="40" rx="3" fill="#292d3a" stroke="${c}" stroke-width="1"/>` +
      `<rect x="${x-19}" y="${y-19}" width="38" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
      `<rect x="${x-15}" y="${y-15}" width="30" height="10" rx="1" fill="#22252e" stroke="${c}" stroke-width=".4"/>` +
      `<rect x="${x-15}" y="${y-2}" width="30" height="10" rx="1" fill="#22252e" stroke="${c}" stroke-width=".4"/>` +
      `<circle cx="${x-10}" cy="${y-10}" r="1.4" fill="#05cc93" filter="url(#tds-bloom)"/>` +
      `<circle cx="${x-10}" cy="${y+3}" r="1.4" fill="${c}" filter="url(#tds-bloom)"/>` +
      `<rect x="${x-6}" y="${y+12}" width="12" height="3" rx="1" fill="${c}" opacity=".3"/>`;
  }

  /** Router */
  static renderRouter(x, y, cfg = {}) {
    const c = cfg.color || '#01a982';
    return `<ellipse cx="${x}" cy="${y}" rx="30" ry="20" fill="${c}" opacity=".04" filter="url(#tds-glow)"/>` +
      `<circle cx="${x}" cy="${y}" r="18" fill="#292d3a" stroke="${c}" stroke-width="1.2"/>` +
      `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="${c}" stroke-width=".5" opacity=".3"/>` +
      // Cross arrows
      `<line x1="${x-8}" y1="${y}" x2="${x+8}" y2="${y}" stroke="${c}" stroke-width="1.5"/>` +
      `<line x1="${x}" y1="${y-8}" x2="${x}" y2="${y+8}" stroke="${c}" stroke-width="1.5"/>` +
      `<polygon points="${x+8},${y-2} ${x+8},${y+2} ${x+12},${y}" fill="${c}"/>` +
      `<polygon points="${x-2},${y-8} ${x+2},${y-8} ${x},${y-12}" fill="${c}"/>` +
      `<polygon points="${x-8},${y-2} ${x-8},${y+2} ${x-12},${y}" fill="${c}"/>` +
      `<polygon points="${x-2},${y+8} ${x+2},${y+8} ${x},${y+12}" fill="${c}"/>`;
  }

  /** Firewall */
  static renderFirewall(x, y, cfg = {}) {
    const c = cfg.color || '#fc6161';
    return `<ellipse cx="${x}" cy="${y}" rx="28" ry="22" fill="${c}" opacity=".04" filter="url(#tds-glow-red)"/>` +
      `<rect x="${x-22}" y="${y-16}" width="44" height="32" rx="4" fill="#292d3a" stroke="${c}" stroke-width="1.2"/>` +
      `<rect x="${x-21}" y="${y-15}" width="42" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
      // Brick pattern
      `<line x1="${x-18}" y1="${y-8}" x2="${x+18}" y2="${y-8}" stroke="${c}" stroke-width=".6" opacity=".4"/>` +
      `<line x1="${x-18}" y1="${y}" x2="${x+18}" y2="${y}" stroke="${c}" stroke-width=".6" opacity=".4"/>` +
      `<line x1="${x-18}" y1="${y+8}" x2="${x+18}" y2="${y+8}" stroke="${c}" stroke-width=".6" opacity=".4"/>` +
      `<line x1="${x-8}" y1="${y-16}" x2="${x-8}" y2="${y-8}" stroke="${c}" stroke-width=".6" opacity=".3"/>` +
      `<line x1="${x+8}" y1="${y-16}" x2="${x+8}" y2="${y-8}" stroke="${c}" stroke-width=".6" opacity=".3"/>` +
      `<line x1="${x}" y1="${y-8}" x2="${x}" y2="${y}" stroke="${c}" stroke-width=".6" opacity=".3"/>` +
      `<line x1="${x-8}" y1="${y}" x2="${x-8}" y2="${y+8}" stroke="${c}" stroke-width=".6" opacity=".3"/>` +
      `<line x1="${x+8}" y1="${y}" x2="${x+8}" y2="${y+8}" stroke="${c}" stroke-width=".6" opacity=".3"/>`;
  }

  /** Database */
  static renderDatabase(x, y, cfg = {}) {
    const c = cfg.color || '#deb146';
    return `<ellipse cx="${x}" cy="${y}" rx="24" ry="24" fill="${c}" opacity=".04" filter="url(#tds-glow-gold)"/>` +
      `<ellipse cx="${x}" cy="${y-14}" rx="18" ry="6" fill="#292d3a" stroke="${c}" stroke-width="1"/>` +
      `<rect x="${x-18}" y="${y-14}" width="36" height="28" fill="#292d3a" stroke="none"/>` +
      `<line x1="${x-18}" y1="${y-14}" x2="${x-18}" y2="${y+14}" stroke="${c}" stroke-width="1"/>` +
      `<line x1="${x+18}" y1="${y-14}" x2="${x+18}" y2="${y+14}" stroke="${c}" stroke-width="1"/>` +
      `<ellipse cx="${x}" cy="${y+14}" rx="18" ry="6" fill="#292d3a" stroke="${c}" stroke-width="1"/>` +
      `<ellipse cx="${x}" cy="${y-2}" rx="18" ry="5" fill="none" stroke="${c}" stroke-width=".5" stroke-dasharray="3 2" opacity=".4"/>` +
      `<circle cx="${x-12}" cy="${y-14}" r="1.2" fill="#05cc93" filter="url(#tds-bloom)"/>`;
  }

  /** ID Card badge */
  static renderIdCard(x, y, cfg = {}) {
    const { mode = 'id' } = cfg;
    const isAuth = mode === 'auth';
    const ac = isAuth ? '#05cc93' : '#deb146';
    const uc = isAuth ? '#01a982' : '#deb146';
    const t = isAuth ? 'AUTHENTICATED' : 'IDENTIFIED';
    const w = 194, h = 73;
    const gf = isAuth ? 'tds-glow-green' : 'tds-glow-gold';
    const userName = cfg.user || 'User';
    const hostName = cfg.host || 'Host';
    const roleName = cfg.role || 'MANAGED';
    return `<rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" rx="8" fill="${ac}" opacity=".04" filter="url(#${gf})"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width="1"/>` +
      `<rect x="${x+1}" y="${y+1}" width="${w-2}" height="1" rx=".5" fill="rgba(255,255,255,.06)"/>` +
      `<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${ac}"/>` +
      `<line x1="${x+12}" y1="${y+19}" x2="${x+w-8}" y2="${y+19}" stroke="rgba(255,255,255,.04)" stroke-width=".5"/>` +
      `<path d="M${x+14},${y+7} L${x+18},${y+4} L${x+22},${y+7} L${x+22},${y+13} Q${x+18},${y+16} ${x+14},${y+13}Z" fill="${ac}" opacity=".4" filter="url(#tds-bloom)"/>` +
      `<text x="${x+28}" y="${y+14}" fill="${ac}" font-size="8" font-weight="700" letter-spacing="1">${t}</text>` +
      `<text x="${x+14}" y="${y+34}" fill="#606a70" font-size="8.5">User:</text><text x="${x+76}" y="${y+34}" fill="${uc}" font-size="8.5">${_esc(userName)}</text>` +
      `<text x="${x+14}" y="${y+47}" fill="#606a70" font-size="8.5">Host:</text><text x="${x+76}" y="${y+47}" fill="#b1b9be" font-size="8.5">${_esc(hostName)}</text>` +
      `<text x="${x+14}" y="${y+60}" fill="#606a70" font-size="8.5">Role:</text><text x="${x+76}" y="${y+60}" fill="${ac}" font-size="8.5" font-weight="700">${_esc(roleName)}</text>`;
  }

  /** Access Point (AP) */
  static renderAP(x, y, cfg = {}) {
    const c = cfg.color || '#00a4b3';
    const gf = TopologyDesigner._glowForColorStatic(c);
    // AP body: rounded rect with antenna and signal waves
    let s = `<ellipse cx="${x}" cy="${y}" rx="26" ry="20" fill="${c}" opacity=".04" filter="url(#${gf})"/>`;
    // Main body
    s += `<rect x="${x-18}" y="${y-8}" width="36" height="20" rx="4" fill="#292d3a" stroke="${c}" stroke-width="1.1"/>`;
    s += `<rect x="${x-17}" y="${y-7}" width="34" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
    // Status LEDs
    s += `<circle cx="${x-10}" cy="${y+2}" r="1.5" fill="#05cc93" filter="url(#tds-bloom)"/>`;
    s += `<circle cx="${x-5}" cy="${y+2}" r="1.5" fill="${c}" opacity=".6"/>`;
    // Antenna stalk
    s += `<line x1="${x}" y1="${y-8}" x2="${x}" y2="${y-22}" stroke="${c}" stroke-width="1.2"/>`;
    s += `<circle cx="${x}" cy="${y-23}" r="2.5" fill="#292d3a" stroke="${c}" stroke-width="1"/>`;
    s += `<circle cx="${x}" cy="${y-23}" r="1" fill="${c}" opacity=".8" filter="url(#tds-bloom)"/>`;
    // Signal waves (concentric arcs)
    s += `<path d="M${x-8},${y-28} A10,10 0 0,1 ${x+8},${y-28}" fill="none" stroke="${c}" stroke-width=".8" opacity=".5"/>`;
    s += `<path d="M${x-13},${y-32} A16,16 0 0,1 ${x+13},${y-32}" fill="none" stroke="${c}" stroke-width=".6" opacity=".3"/>`;
    s += `<path d="M${x-18},${y-36} A22,22 0 0,1 ${x+18},${y-36}" fill="none" stroke="${c}" stroke-width=".5" opacity=".2"/>`;
    return s;
  }

  /** Overlay cloud — spans multiple underlay cloud positions
   *  cfg.spans: [nodeId, ...] — IDs of underlay nodes this overlay encompasses (resolved at render time to cfg._resolvedSpans)
   *  cfg._resolvedSpans: [{x, y}...] — resolved positions (set by render engine)
   *  cfg.padding: extra padding around the span (default 90)
   */
  static renderOverlayCloud(x, y, cfg = {}) {
    const { label = '', color = '#7764fc', sub1 = '', padding = 90 } = cfg;
    const spanPositions = cfg._resolvedSpans || cfg.spans || [];
    const gf = TopologyDesigner._glowForColorStatic(color);
    let s = '';
    if (spanPositions.length >= 2 && typeof spanPositions[0] === 'object') {
      // Compute bounding box of all spanned positions
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of spanPositions) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rx = (maxX - minX) / 2 + padding;
      const ry = (maxY - minY) / 2 + padding * 0.6;
      // Outer glow
      s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx + 10}" ry="${ry + 6}" fill="${color}" opacity=".02" filter="url(#${gf})"/>`;
      // Main shape
      s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" opacity=".04" stroke="${color}" stroke-width="1" stroke-dasharray="8 4"/>`;
      // Label at top center of the overlay
      const ty = cy - ry + 16;
      s += `<text x="${cx}" y="${ty}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700" opacity=".8" filter="url(#${gf})">${_esc(label)}</text>`;
      if (sub1) s += `<text x="${cx}" y="${ty + 14}" text-anchor="middle" fill="${color}" font-size="8" opacity=".5">${_esc(sub1)}</text>`;
    } else {
      // Fallback: render as a regular cloud centered at x,y
      s = TopologyDesigner.renderCloud(x, y, cfg);
    }
    return s;
  }

  /** Freeform text label node with optional multi-line sublabel */
  static renderText(x, y, cfg = {}) {
    const { label = '', color = '#e6e8e9', fontSize = 14, fontWeight = '600', sublabel = '' } = cfg;
    const text = label || 'Text';
    let s = `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}" opacity=".9">${_esc(text)}</text>`;
    if (sublabel) {
      const subLines = sublabel.split('\n');
      const subSize = Math.max(8, fontSize * 0.7);
      const lineHeight = subSize * 1.4;
      const startY = y + 5 + fontSize * 0.9;
      subLines.forEach((line, i) => {
        s += `<text x="${x}" y="${startY + i * lineHeight}" text-anchor="middle" fill="${color}" font-size="${subSize}" font-weight="400" opacity=".65">${_esc(line)}</text>`;
      });
    }
    return s;
  }

  /* ── Basic Shape Renderers ── */

  /** Arrow shape */
  static renderShapeArrow(x, y, cfg = {}) {
    const { color = '#01a982', label = '' } = cfg;
    const variant = cfg.variant || 'right';
    let points;
    if (variant === 'right') points = `${x-24},${y-8} ${x+8},${y-8} ${x+24},${y} ${x+8},${y+8} ${x-24},${y+8}`;
    else if (variant === 'left') points = `${x+24},${y-8} ${x-8},${y-8} ${x-24},${y} ${x-8},${y+8} ${x+24},${y+8}`;
    else if (variant === 'up') points = `${x-8},${y+24} ${x-8},${y-8} ${x},${y-24} ${x+8},${y-8} ${x+8},${y+24}`;
    else points = `${x-8},${y-24} ${x-8},${y+8} ${x},${y+24} ${x+8},${y+8} ${x+8},${y-24}`;
    return `<polygon points="${points}" fill="${color}" opacity=".12" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Square shape */
  static renderShapeSquare(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const s = cfg.shapeSize || 32;
    const hs = s / 2;
    return `<rect x="${x-hs}" y="${y-hs}" width="${s}" height="${s}" rx="3" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Rectangle shape */
  static renderShapeRectangle(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const w = cfg.shapeWidth || 52;
    const h = cfg.shapeHeight || 30;
    return `<rect x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="4" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Triangle shape */
  static renderShapeTriangle(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const variant = cfg.variant || 'up';
    const s = cfg.shapeSize || 36;
    const hs = s / 2;
    let points;
    if (variant === 'up') points = `${x},${y-hs} ${x+hs},${y+hs*0.7} ${x-hs},${y+hs*0.7}`;
    else if (variant === 'down') points = `${x},${y+hs} ${x+hs},${y-hs*0.7} ${x-hs},${y-hs*0.7}`;
    else if (variant === 'left') points = `${x-hs},${y} ${x+hs*0.7},${y-hs} ${x+hs*0.7},${y+hs}`;
    else points = `${x+hs},${y} ${x-hs*0.7},${y-hs} ${x-hs*0.7},${y+hs}`;
    return `<polygon points="${points}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Circle shape */
  static renderShapeCircle(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const r = cfg.shapeSize ? cfg.shapeSize / 2 : 18;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Ellipse shape */
  static renderShapeEllipse(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const rx = cfg.shapeWidth ? cfg.shapeWidth / 2 : 26;
    const ry = cfg.shapeHeight ? cfg.shapeHeight / 2 : 16;
    return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Diamond shape */
  static renderShapeDiamond(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const s = cfg.shapeSize || 36;
    const hs = s / 2;
    return `<polygon points="${x},${y-hs} ${x+hs},${y} ${x},${y+hs} ${x-hs},${y}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Pentagon shape */
  static renderShapePentagon(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const r = cfg.shapeSize ? cfg.shapeSize / 2 : 18;
    let pts = '';
    for (let i = 0; i < 5; i++) {
      const angle = (i * 72 - 90) * Math.PI / 180;
      pts += `${x + r * Math.cos(angle)},${y + r * Math.sin(angle)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Hexagon shape */
  static renderShapeHexagon(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const r = cfg.shapeSize ? cfg.shapeSize / 2 : 20;
    let pts = '';
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60 - 90) * Math.PI / 180;
      pts += `${x + r * Math.cos(angle)},${y + r * Math.sin(angle)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Star shape */
  static renderShapeStar(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const outer = cfg.shapeSize ? cfg.shapeSize / 2 : 20;
    const inner = outer * 0.4;
    let pts = '';
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const angle = (i * 36 - 90) * Math.PI / 180;
      pts += `${x + r * Math.cos(angle)},${y + r * Math.sin(angle)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /** Cross / plus shape */
  static renderShapeCross(x, y, cfg = {}) {
    const { color = '#01a982' } = cfg;
    const s = cfg.shapeSize || 36;
    const t = s * 0.3; // thickness
    const hs = s / 2;
    const ht = t / 2;
    return `<polygon points="${x-ht},${y-hs} ${x+ht},${y-hs} ${x+ht},${y-ht} ${x+hs},${y-ht} ${x+hs},${y+ht} ${x+ht},${y+ht} ${x+ht},${y+hs} ${x-ht},${y+hs} ${x-ht},${y+ht} ${x-hs},${y+ht} ${x-hs},${y-ht} ${x-ht},${y-ht}" fill="${color}" opacity=".1" stroke="${color}" stroke-width="1.2"/>`;
  }

  /* Node type registry */
  static NODE_TYPES = {
    ec:               TopologyDesigner.renderEC,
    switch:           TopologyDesigner.renderSwitch,
    switchEnterprise: TopologyDesigner.renderSwitchEnterprise,
    cloud:            TopologyDesigner.renderCloud,
    host:      TopologyDesigner.renderHost,
    connector: TopologyDesigner.renderConnector,
    apps:      TopologyDesigner.renderApps,
    saas:      TopologyDesigner.renderSaaS,
    server:    TopologyDesigner.renderServer,
    router:    TopologyDesigner.renderRouter,
    firewall:  TopologyDesigner.renderFirewall,
    database:  TopologyDesigner.renderDatabase,
    idcard:    TopologyDesigner.renderIdCard,
    ap:        TopologyDesigner.renderAP,
    overlayCloud: TopologyDesigner.renderOverlayCloud,
    text:      TopologyDesigner.renderText,
    // Basic shapes
    'shape:arrow':     TopologyDesigner.renderShapeArrow,
    'shape:square':    TopologyDesigner.renderShapeSquare,
    'shape:rectangle': TopologyDesigner.renderShapeRectangle,
    'shape:triangle':  TopologyDesigner.renderShapeTriangle,
    'shape:circle':    TopologyDesigner.renderShapeCircle,
    'shape:ellipse':   TopologyDesigner.renderShapeEllipse,
    'shape:diamond':   TopologyDesigner.renderShapeDiamond,
    'shape:pentagon':  TopologyDesigner.renderShapePentagon,
    'shape:hexagon':   TopologyDesigner.renderShapeHexagon,
    'shape:star':      TopologyDesigner.renderShapeStar,
    'shape:cross':     TopologyDesigner.renderShapeCross,
  };

  /* Plugin metadata storage */
  static _nodePluginMeta = {};
  static _linkPlugins = {};

  // Note: registerNodeType and registerLinkType are defined above with full plugin interface

  /** Render a single node by its config */
  _renderNodeSVG(nodeCfg) {
    const renderer = TopologyDesigner.NODE_TYPES[nodeCfg.type];
    if (!renderer) {
      if (nodeCfg.render) return nodeCfg.render(nodeCfg.x, nodeCfg.y, nodeCfg);
      console.warn(`Unknown node type: ${nodeCfg.type}`);
      return '';
    }
    return renderer(nodeCfg.x, nodeCfg.y, nodeCfg);
  }

  /* ══════════════════════════════════════════
     LINK RENDERERS
     Phase-aware connection drawing
     ══════════════════════════════════════════ */

  /** Simple line */
  _renderLine(stepId, phaseNum, x1, y1, x2, y2, color, op, dashed = false, strokeWidth = 2) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const blur = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const sw = strokeWidth;
    if (anim) {
      return `<g${blur}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" ${dashed ? 'stroke-dasharray="6 4"' : 'stroke-dasharray="2000" stroke-dashoffset="0"'} class="${dashed ? 'tds-phase-in' : 'tds-draw-phase'}" style="opacity:${0.7*op};animation-delay:${delay}s"/></g>`;
    }
    return `<g${blur}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" ${dashed ? 'stroke-dasharray="6 4"' : ''} opacity="${0.7*op}"/></g>`;
  }

  /** Animated flow particles along a path, controllable by per-link flow cfg. */
  _flowParticles(path, color, opts) {
    const speed = opts && opts.speed ? opts.speed : 2.5;
    const count = Math.max(1, Math.min(32, Math.round((opts && opts.particles) || 3)));
    const rev = opts && opts.reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : '';
    let s = '';
    for (let i = 0; i < count; i++) {
      s += `<circle r="3" fill="${color}" opacity=".8" filter="url(#tds-bloom)">` +
        `<animateMotion dur="${(speed + i * 0.4).toFixed(2)}s" repeatCount="indefinite" begin="${(i * 0.4).toFixed(2)}s" ${rev} path="${path}"/></circle>`;
    }
    return s;
  }

  /** True if a per-link flow config overrides the default particle animation. */
  _hasFlowCfg(opts) {
    return !!opts && (opts.speed != null || opts.particles != null || opts.reverse != null);
  }

  /** IPsec-style tunnel — ethereal multi-layer glow with bloom, tube volume & filmic grading */
  _renderTunnel(stepId, phaseNum, path, color, label, lx, ly, op, dots = true, flow) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const ad = anim ? ` class="tds-draw-phase" style="animation-delay:${delay}s"` : '';
    const mobile = this._isMobile;
    const bloomF = !mobile ? 'url(#tds-tunnel-bloom)' : 'url(#tds-glow-strong)';
    // Filmic color grading wrapper (ACES-like tone mapping, skip on mobile)
    const filmicOpen = !mobile ? '<g filter="url(#tds-tunnel-filmic)">' : '';
    const filmicClose = !mobile ? '</g>' : '';
    return filmicOpen +
      `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>` +
      // Layer 1: Multi-scale bloom aura (approximates UnrealBloom light bleed)
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="24" stroke-linejoin="round" stroke-linecap="round" opacity=".05" filter="${bloomF}"/>` +
      // Layer 2: Tube volume (cylindrical 3D illusion via diffuse lighting)
      (!mobile ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" opacity=".15" filter="url(#tds-tunnel-tube)"/>` : '') +
      // Layer 3: Inner luminous corridor
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" opacity=".1" filter="url(#tds-bloom)"/>` +
      // Layer 4: Core energy line (draw animation)
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="2000" stroke-dashoffset="0" opacity=".65"${ad}/>` +
      // Layer 5: Dashed encrypted overlay
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 5" opacity=".3"/>` +
      // Animated particles (forward + trailing + reverse); per-link flow cfg overrides.
      (dots && !this.reducedMotion && !mobile ?
        (this._hasFlowCfg(flow) ? this._flowParticles(path, color, flow) :
          `<circle r="3.5" fill="${color}" opacity=".9" filter="url(#tds-bloom)"><animateMotion dur="2.5s" repeatCount="indefinite" path="${path}"/></circle>` +
          `<circle r="2" fill="${color}" opacity=".5"><animateMotion dur="2.5s" repeatCount="indefinite" begin="1.2s" path="${path}"/></circle>` +
          `<circle r="3" fill="${color}" opacity=".85" filter="url(#tds-bloom)"><animateMotion dur="2.8s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear" path="${path}"/></circle>`)
      : '') +
      (label && lx != null ? `<rect x="${lx-61}" y="${ly-10}" width="122" height="20" rx="5" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>` +
        `<rect x="${lx-60}" y="${ly-9}" width="120" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
        `<text x="${lx}" y="${ly+3}" text-anchor="middle" fill="${color}" font-size="8" font-weight="600">${_esc(label)}</text>` : '') +
      '</g>' + filmicClose;
  }

  /** WireGuard-style dashed tunnel */
  _renderWG(stepId, phaseNum, x1, y1, x2, y2, label, op, dots = true, labelOffset, flow) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    const a = Math.atan2(y2-y1, x2-x1);
    const loX = labelOffset?.x || 0, loY = labelOffset?.y || 0;
    const lx = mx + Math.sin(a)*14 + Math.cos(a)*loX + Math.sin(a)*loY, ly = my - Math.cos(a)*14 + Math.sin(a)*loX - Math.cos(a)*loY;
    return `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#65aef9" stroke-width="6" opacity=".03" filter="url(#tds-glow-blue)"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#65aef9" stroke-width="1.2" stroke-dasharray="5 3" opacity=".5"/>` +
      (dots && !this.reducedMotion ? (this._hasFlowCfg(flow) ? this._flowParticles(`M${x1},${y1} L${x2},${y2}`, '#65aef9', flow) : `<circle r="2.5" fill="#65aef9" opacity=".8" filter="url(#tds-bloom)"><animateMotion dur="2.5s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}"/></circle>`) : '') +
      (label ? `<rect x="${lx-47}" y="${ly-9}" width="94" height="18" rx="4" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".4"/>` +
        `<rect x="${lx-46}" y="${ly-8}" width="92" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
        `<text x="${lx}" y="${ly+3}" text-anchor="middle" fill="#65aef9" font-size="7" font-weight="600">${_esc(label)}</text>` : '') +
      '</g>';
  }

  /** Animated flow path (with optional custom SVG path) */
  _renderFlow(stepId, phaseNum, path, color, label, lx, ly, op, dots = true, flow) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    return `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>` +
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="8" opacity=".03" filter="url(#tds-glow)"/>` +
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="2000" stroke-dashoffset="0" opacity=".4" ${anim ? `class="tds-draw-phase" style="animation-delay:${delay}s"` : ''}/>` +
      `<path d="${path}" fill="none" stroke="${color}" stroke-width=".8" stroke-dasharray="5 4" opacity=".2"/>` +
      (dots && !this.reducedMotion ? (this._hasFlowCfg(flow) ? this._flowParticles(path, color, flow) :
        `<circle r="3.5" fill="${color}" opacity=".9" filter="url(#tds-bloom)"><animateMotion dur="3s" repeatCount="indefinite" path="${path}"/></circle>` +
        `<circle r="2" fill="${color}" opacity=".5"><animateMotion dur="3s" repeatCount="indefinite" begin="1s" path="${path}"/></circle>`) : '') +
      (label && lx != null ? `<rect x="${lx-55}" y="${ly-10}" width="110" height="20" rx="5" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>` +
        `<rect x="${lx-54}" y="${ly-9}" width="108" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
        `<text x="${lx}" y="${ly+3}" text-anchor="middle" fill="${color}" font-size="7.5" font-weight="600">${_esc(label)}</text>` : '') +
      '</g>';
  }

  /** Packet burst */
  _renderPacket(stepId, phaseNum, x1, y1, x2, y2, color, label, sub, op, labelOffset) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    const a = Math.atan2(y2-y1, x2-x1);
    const loX = labelOffset?.x || 0, loY = labelOffset?.y || 0;
    const ox = Math.sin(a)*20 + Math.cos(a)*loX + Math.sin(a)*loY, oy = -Math.cos(a)*20 + Math.sin(a)*loX - Math.cos(a)*loY;
    const h = sub ? 32 : 22;
    return `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade-fast" style="opacity:${op}"`}>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="4" opacity=".03" filter="url(#tds-glow)"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 7" opacity=".35"/>` +
      (!this.reducedMotion ? `<circle r="4.5" fill="${color}" filter="url(#tds-bloom)"><animateMotion dur="1.5s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}"/></circle>` : '') +
      (label ? `<rect x="${mx+ox-69}" y="${my+oy-(sub?19:13)}" width="138" height="${h}" rx="6" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>` +
        `<rect x="${mx+ox-68}" y="${my+oy-(sub?18:12)}" width="136" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
        `<text x="${mx+ox}" y="${my+oy-(sub?4:0)}" text-anchor="middle" fill="${color}" font-size="9" font-weight="600">${_esc(label)}</text>` +
        (sub ? `<text x="${mx+ox}" y="${my+oy+9}" text-anchor="middle" fill="${color}" font-size="7.5" opacity=".8">${_esc(sub)}</text>` : '') : '') +
      '</g>';
  }

  /** Blocked indicator with X mark */
  _renderBlocked(stepId, phaseNum, x1, y1, x2, y2, reason) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    return `<g ${anim ? `class="tds-phase-in" style="opacity:1;animation-delay:${delay}s"` : 'class="tds-fade-fast" style="opacity:1"'}>` +
      `<line x1="${x1}" y1="${y1}" x2="${mx}" y2="${my}" stroke="#fc6161" stroke-width="2" stroke-dasharray="8 4" opacity=".6"/>` +
      `<ellipse cx="${mx}" cy="${my}" rx="22" ry="22" fill="#fc6161" opacity=".06" filter="url(#tds-glow-red)"><animate attributeName="opacity" values=".04;.1;.04" dur="1.5s" repeatCount="indefinite"/></ellipse>` +
      `<circle cx="${mx}" cy="${my}" r="14" fill="#1d1f27" stroke="#fc6161" stroke-width="1.5" filter="url(#tds-glow)"/>` +
      `<line x1="${mx-6}" y1="${my-6}" x2="${mx+6}" y2="${my+6}" stroke="#fc6161" stroke-width="2.5" filter="url(#tds-bloom)"/>` +
      `<line x1="${mx+6}" y1="${my-6}" x2="${mx-6}" y2="${my+6}" stroke="#fc6161" stroke-width="2.5" filter="url(#tds-bloom)"/>` +
      `<rect x="${mx-38}" y="${my+18}" width="76" height="16" rx="4" fill="#fc6161" opacity=".12" stroke="#fc6161" stroke-width=".5"/>` +
      `<text x="${mx}" y="${my+29}" text-anchor="middle" fill="#fc6161" font-size="8" font-weight="700" filter="url(#tds-glow)">BLOCKED</text>` +
      (reason ? `<rect x="${mx-108}" y="${my+38}" width="216" height="20" rx="6" fill="url(#tds-labelGlass)" opacity=".94" stroke="#fc6161" stroke-width=".4"/>` +
        `<text x="${mx}" y="${my+52}" text-anchor="middle" fill="#fc6161" font-size="7.5" opacity=".9">${_esc(reason)}</text>` : '') +
      '</g>';
  }

  /** Wifi link — wireless with prominent signal wave arcs and wifi icon */
  _renderWifi(stepId, phaseNum, x1, y1, x2, y2, color, label, op, labelOffset) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const loX = labelOffset?.x || 0, loY = labelOffset?.y || 0;
    const lx = mx + Math.sin(a) * 28 + Math.cos(a)*loX + Math.sin(a)*loY, ly = my - Math.cos(a) * 28 + Math.sin(a)*loX - Math.cos(a)*loY;
    const c = color || '#00a4b3';
    const gf = this._glowForColor(c);
    // Perpendicular angle for signal arcs
    const pa = a + Math.PI / 2;
    let s = `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>`;
    // Dashed wireless link line (not solid — visually distinct from wired)
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="10" opacity=".03" filter="url(#${gf})"/>`;
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1.5" stroke-dasharray="4 6" opacity=".35" ${anim ? `class="tds-phase-in" style="animation-delay:${delay}s"` : ''}/>`;
    // Signal wave arcs radiating from BOTH endpoints (not just midpoint)
    // Source-side arcs (radiating toward destination)
    const srcA = a; // angle toward destination
    for (let i = 1; i <= 3; i++) {
      const r = i * 7;
      const arc1x = x1 + Math.cos(srcA - 0.5) * r;
      const arc1y = y1 + Math.sin(srcA - 0.5) * r;
      const arc2x = x1 + Math.cos(srcA + 0.5) * r;
      const arc2y = y1 + Math.sin(srcA + 0.5) * r;
      s += `<path d="M${arc1x},${arc1y} A${r},${r} 0 0,1 ${arc2x},${arc2y}" fill="none" stroke="${c}" stroke-width="${1.2 - i * 0.2}" opacity="${0.5 - i * 0.12}" filter="url(#tds-glow)">`;
      if (!this.reducedMotion) {
        s += `<animate attributeName="opacity" values="${0.5 - i * 0.12};${0.1};${0.5 - i * 0.12}" dur="1.8s" begin="${i * 0.2}s" repeatCount="indefinite"/>`;
      }
      s += `</path>`;
    }
    // Destination-side arcs (radiating back toward source)
    const dstA = a + Math.PI;
    for (let i = 1; i <= 3; i++) {
      const r = i * 7;
      const arc1x = x2 + Math.cos(dstA - 0.5) * r;
      const arc1y = y2 + Math.sin(dstA - 0.5) * r;
      const arc2x = x2 + Math.cos(dstA + 0.5) * r;
      const arc2y = y2 + Math.sin(dstA + 0.5) * r;
      s += `<path d="M${arc1x},${arc1y} A${r},${r} 0 0,1 ${arc2x},${arc2y}" fill="none" stroke="${c}" stroke-width="${1.2 - i * 0.2}" opacity="${0.5 - i * 0.12}" filter="url(#tds-glow)">`;
      if (!this.reducedMotion) {
        s += `<animate attributeName="opacity" values="${0.5 - i * 0.12};${0.1};${0.5 - i * 0.12}" dur="1.8s" begin="${i * 0.2 + 0.9}s" repeatCount="indefinite"/>`;
      }
      s += `</path>`;
    }
    // Wifi icon at midpoint (concentric arcs + dot)
    s += `<circle cx="${mx}" cy="${my}" r="12" fill="#1d1f27" opacity=".85"/>`;
    s += `<circle cx="${mx}" cy="${my}" r="12" fill="none" stroke="${c}" stroke-width=".6" opacity=".4"/>`;
    // Wifi symbol (3 arcs + dot, pointing upward relative to link direction)
    const wUp = a - Math.PI / 2; // perpendicular "up"
    s += `<circle cx="${mx}" cy="${my + 3}" r="1.5" fill="${c}" opacity=".9" filter="url(#tds-bloom)"/>`;
    for (let i = 1; i <= 3; i++) {
      const wr = i * 3.5;
      s += `<path d="M${mx - wr * 0.7},${my + 3 - wr * 0.5} A${wr},${wr} 0 0,1 ${mx + wr * 0.7},${my + 3 - wr * 0.5}" fill="none" stroke="${c}" stroke-width="${1.2 - i * 0.15}" opacity="${0.9 - i * 0.2}"/>`;
    }
    // Animated signal particles along the dashed line
    if (!this.reducedMotion) {
      s += `<circle r="2" fill="${c}" opacity=".6" filter="url(#tds-bloom)"><animateMotion dur="2s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}"/></circle>`;
      s += `<circle r="2" fill="${c}" opacity=".6" filter="url(#tds-bloom)"><animateMotion dur="2s" repeatCount="indefinite" begin="1s" path="M${x2},${y2} L${x1},${y1}"/></circle>`;
    }
    // Label
    if (label) {
      s += `<rect x="${lx - 55}" y="${ly - 10}" width="110" height="20" rx="5" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>` +
        `<rect x="${lx - 54}" y="${ly - 9}" width="108" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>` +
        `<text x="${lx}" y="${ly + 3}" text-anchor="middle" fill="${c}" font-size="8" font-weight="600">${_esc(label)}</text>`;
    }
    s += '</g>';
    return s;
  }

  /** PoE link — power over ethernet with voltage/lightning icon */
  _renderPoE(stepId, phaseNum, x1, y1, x2, y2, color, label, op, labelOffset) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const c = color || '#ec8c25';
    const gf = this._glowForColor(c);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const loX = labelOffset?.x || 0, loY = labelOffset?.y || 0;
    const lx = mx + Math.sin(a) * 20 + Math.cos(a)*loX + Math.sin(a)*loY, ly = my - Math.cos(a) * 20 + Math.sin(a)*loX - Math.cos(a)*loY;
    let s = `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>`;
    // Background glow
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="8" opacity=".04" filter="url(#${gf})"/>`;
    // Main line (solid)
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2" stroke-dasharray="2000" stroke-dashoffset="0" opacity=".5" ${anim ? `class="tds-draw-phase" style="animation-delay:${delay}s"` : ''}/>`;
    // Secondary detail dashes
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width=".8" stroke-dasharray="3 6" opacity=".3"/>`;
    // Voltage/Lightning bolt icon at midpoint
    s += `<circle cx="${mx}" cy="${my}" r="10" fill="#1d1f27" stroke="${c}" stroke-width=".8" opacity=".9"/>`;
    s += `<path d="M${mx-3},${my-7} L${mx+1},${my-1} L${mx-1},${my-1} L${mx+3},${my+7} L${mx-1},${my+1} L${mx+1},${my+1}Z" fill="${c}" opacity=".9" filter="url(#tds-bloom)"/>`;
    // Animated energy pulse along line
    if (!this.reducedMotion) {
      s += `<circle r="2.5" fill="${c}" opacity=".7" filter="url(#tds-bloom)"><animateMotion dur="1.8s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}"/></circle>`;
    }
    // Label
    if (label) {
      s += `<rect x="${lx - 45}" y="${ly - 9}" width="90" height="18" rx="4" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".4"/>`;
      s += `<rect x="${lx - 44}" y="${ly - 8}" width="88" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
      s += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" fill="${c}" font-size="7.5" font-weight="600">${_esc(label)}</text>`;
    }
    s += '</g>';
    return s;
  }

  /** Optical link — fiber optic with laser warning icon */
  _renderOptical(stepId, phaseNum, x1, y1, x2, y2, color, label, op, labelOffset) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    const dofF = op < 0.9 && this.step > 0 ? ' filter="url(#tds-dof-blur)"' : '';
    const c = color || '#65aef9';
    const gf = this._glowForColor(c);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const loX = labelOffset?.x || 0, loY = labelOffset?.y || 0;
    const lx = mx + Math.sin(a) * 22 + Math.cos(a)*loX + Math.sin(a)*loY, ly = my - Math.cos(a) * 22 + Math.sin(a)*loX - Math.cos(a)*loY;
    let s = `<g${dofF} ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>`;
    // Bright core line (thin, intense — like a laser)
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="12" opacity=".03" filter="url(#${gf})"/>`;
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1" opacity=".7" ${anim ? `stroke-dasharray="2000" stroke-dashoffset="0" class="tds-draw-phase" style="animation-delay:${delay}s"` : ''}/>`;
    // Outer cladding (thin parallel lines)
    const px = Math.sin(a) * 3, py = -Math.cos(a) * 3;
    s += `<line x1="${x1+px}" y1="${y1+py}" x2="${x2+px}" y2="${y2+py}" stroke="${c}" stroke-width=".3" opacity=".2"/>`;
    s += `<line x1="${x1-px}" y1="${y1-py}" x2="${x2-px}" y2="${y2-py}" stroke="${c}" stroke-width=".3" opacity=".2"/>`;
    // Laser warning triangle icon at midpoint
    s += `<circle cx="${mx}" cy="${my}" r="10" fill="#1d1f27" stroke="${c}" stroke-width=".8" opacity=".9"/>`;
    // Triangle
    s += `<polygon points="${mx},${my-7} ${mx-6},${my+4} ${mx+6},${my+4}" fill="none" stroke="${c}" stroke-width="1" opacity=".9"/>`;
    // Exclamation in triangle
    s += `<line x1="${mx}" y1="${my-4}" x2="${mx}" y2="${my+1}" stroke="${c}" stroke-width="1.2" opacity=".9"/>`;
    s += `<circle cx="${mx}" cy="${my+3}" r=".8" fill="${c}" opacity=".9"/>`;
    // Fast-moving light pulse
    if (!this.reducedMotion) {
      s += `<circle r="2" fill="${c}" opacity=".9" filter="url(#tds-bloom)"><animateMotion dur="0.8s" repeatCount="indefinite" path="M${x1},${y1} L${x2},${y2}"/></circle>`;
      s += `<circle r="1.5" fill="#fff" opacity=".4"><animateMotion dur="0.8s" repeatCount="indefinite" begin="0.05s" path="M${x1},${y1} L${x2},${y2}"/></circle>`;
    }
    // Label
    if (label) {
      s += `<rect x="${lx - 45}" y="${ly - 9}" width="90" height="18" rx="4" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".4"/>`;
      s += `<rect x="${lx - 44}" y="${ly - 8}" width="88" height="1" rx=".5" fill="rgba(255,255,255,.04)"/>`;
      s += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" fill="${c}" font-size="7.5" font-weight="600">${_esc(label)}</text>`;
    }
    s += '</g>';
    return s;
  }

  /** Callout / label badge */
  _renderCallout(stepId, phaseNum, x, y, w, h, lines, borderColor, op = 1) {
    const { show, anim, delay } = this._ph(stepId, phaseNum);
    if (!show) return '';
    let svg = `<g ${anim ? `class="tds-phase-in" style="opacity:${op};animation-delay:${delay}s"` : `class="tds-fade" style="opacity:${op}"`}>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="url(#tds-labelGlass)" stroke="${borderColor || 'rgba(255,255,255,.06)'}" stroke-width="${borderColor ? '.5' : '1'}"/>`;
    lines.forEach((line, i) => {
      svg += `<text x="${x + w/2}" y="${y + 14 + i * 14}" text-anchor="middle" fill="${line.color || '#b1b9be'}" font-size="${line.size || '8'}" font-weight="${line.weight || '400'}">${_esc(line.text)}</text>`;
    });
    svg += '</g>';
    return svg;
  }

  /** Zone label (dashed rect below a node) */
  _renderZoneLabel(stepId, phaseNum, x, y, label, color, op = 1) {
    return this._pw(stepId, phaseNum, op,
      `<rect x="${x-60}" y="${y}" width="120" height="18" rx="4" fill="${color}" opacity=".07" stroke="${color}" stroke-width=".5" stroke-dasharray="3 2"/>` +
      `<text x="${x}" y="${y+12}" text-anchor="middle" fill="${color}" font-size="9" font-weight="600" opacity=".9">${_esc(label)}</text>`
    );
  }

  /** Node label (text below/beside a node) */
  _renderNodeLabel(x, y, label, sublabel, color = '#e6e8e9') {
    const displayLabel = label && label.length > 24 ? label.slice(0, 24) + '…' : label;
    let s = `<text x="${x}" y="${y}" text-anchor="middle" fill="${color}" font-size="10" font-weight="600">${_esc(displayLabel)}</text>`;
    if (sublabel) s += `<text x="${x}" y="${y+13}" text-anchor="middle" fill="#7d8a92" font-size="7.5">${_esc(sublabel)}</text>`;
    return s;
  }

  /** Side label (text to the left or right of a node) */
  _renderSideLabel(x, y, label, sublabel, color, anchor = 'end') {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-size="13" font-weight="700">${_esc(label)}</text>` +
      (sublabel ? `<text x="${x}" y="${y+15}" text-anchor="${anchor}" fill="#7d8a92" font-size="8.5">${_esc(sublabel)}</text>` : '');
  }

  /** Zone annotation rectangle — encompasses nodes and child zones with a labeled border */
  _renderZoneRect(zone) {
    // Include both direct nodes and all descendant nodes from child zones
    const allNodes = this._getZoneNodesRecursive(zone.id);
    if (allNodes.length === 0) return '';
    const pad = zone.padding || 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nId of allNodes) {
      // Only include nodes visible at the current step
      if (this.step > 0) {
        const sp = this._findShowPhase(nId);
        if (!sp || this.step < this._stepIndex[sp.stepId]) continue;
      }
      const pos = this._pos(nId);
      if (!pos) continue;
      minX = Math.min(minX, pos.x - 40);
      minY = Math.min(minY, pos.y - 30);
      maxX = Math.max(maxX, pos.x + 40);
      maxY = Math.max(maxY, pos.y + 30);
    }
    if (!isFinite(minX)) return '';
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX, h = maxY - minY;
    const c = zone.color || '#7d8a92';
    const dash = zone.borderStyle === 'dotted' ? '2 3' : zone.borderStyle === 'solid' ? 'none' : '6 4';
    const align = zone.labelAlign || 'left';
    const labelX = align === 'center' ? minX + w / 2 : align === 'right' ? maxX - 8 : minX + 8;
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    let s = `<g class="tds-zone" data-zone-id="${zone.id}">`;
    s += `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" rx="8" fill="${c}" fill-opacity=".04" stroke="${c}" stroke-width="1" stroke-opacity=".35"${dash !== 'none' ? ` stroke-dasharray="${dash}"` : ''}/>`;
    s += `<text x="${labelX}" y="${minY + 14}" text-anchor="${anchor}" fill="${c}" font-size="9" font-weight="700" letter-spacing="1" opacity=".7">${_esc(zone.label || zone.id)}</text>`;
    const sublabelText = zone.sublabel || zone.description;
    if (sublabelText) {
      s += `<text x="${labelX}" y="${minY + 26}" text-anchor="${anchor}" fill="${c}" font-size="7" opacity=".5">${_esc(sublabelText)}</text>`;
    }
    s += `</g>`;
    return s;
  }

  /** WAN/LAN zone indicator beside EC */
  _renderZoneIndicator(x, y, side = 'right') {
    const anchor = side === 'right' ? 'start' : 'end';
    const dx = side === 'right' ? 36 : -36;
    return `<g opacity=".7">` +
      `<text x="${x+dx}" y="${y-8}" text-anchor="${anchor}" fill="#b1b9be" font-size="7" font-weight="700" letter-spacing=".5">${side==='right'?'WAN ↑':'↑ WAN'}</text>` +
      `<text x="${x+dx}" y="${y+12}" text-anchor="${anchor}" fill="#01a982" font-size="7" font-weight="700" letter-spacing=".5">${side==='right'?'LAN ↓':'↓ LAN'}</text></g>`;
  }

  /* ══════════════════════════════════════════
     DECLARATIVE RENDER ENGINE
     Renders all nodes/links based on step phases
     ══════════════════════════════════════════ */

  /**
   * Find which step & phase first shows an element id.
   * Returns { stepId, phaseNum } or null.
   */
  _findShowPhase(elementId) {
    // Use O(1) index if available (built by _buildIndex)
    if (this._showIndex && this._showIndex.has(elementId)) {
      return this._showIndex.get(elementId);
    }
    // Fallback: linear scan (pre-buildIndex or dynamic elements)
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (let p = 0; p < step.phases.length; p++) {
        const phase = step.phases[p];
        if (phase.show && phase.show.includes(elementId)) {
          return { stepId: step.id, phaseNum: p };
        }
      }
    }
    return null;
  }

  /**
   * Get the halo color for a node's focus wrap.
   */
  _haloForNode(nodeCfg) {
    const c = nodeCfg.color || nodeCfg.haloColor;
    if (!c) {
      // Default by type
      const typeMap = {
        ec: 'green', switch: 'green', switchEnterprise: 'green', cloud: 'blue', host: 'green',
        connector: 'blue', apps: 'gold', saas: 'gold', server: 'green',
        router: 'green', firewall: 'green', database: 'gold', idcard: 'gold',
        'shape:arrow': 'green', 'shape:square': 'green', 'shape:rectangle': 'green',
        'shape:triangle': 'green', 'shape:circle': 'green', 'shape:ellipse': 'green',
        'shape:diamond': 'green', 'shape:pentagon': 'green', 'shape:hexagon': 'green',
        'shape:star': 'green', 'shape:cross': 'green',
      };
      return `tds-focus-halo-${typeMap[nodeCfg.type] || 'green'}`;
    }
    const colorMap = { '#01a982':'green', '#05cc93':'green', '#068667':'green',
      '#65aef9':'blue', '#7764fc':'purple', '#deb146':'gold', '#fc6161':'green' };
    return `tds-focus-halo-${colorMap[c] || 'green'}`;
  }

  /**
   * Get the glow filter name for a color.
   */
  _glowForColor(c) {
    const map = { '#01a982':'tds-glow-green', '#068667':'tds-glow-green', '#05cc93':'tds-glow-green',
      '#65aef9':'tds-glow-blue', '#7764fc':'tds-glow-purple', '#deb146':'tds-glow-gold',
      '#fc6161':'tds-glow-red', '#d25f4b':'tds-glow', '#b1b9be':'tds-glow' };
    return map[c] || 'tds-glow';
  }

  /** Render endpoint (port) labels near link source/destination */
  _renderEndpointLabels(x1, y1, x2, y2, linkCfg, op) {
    const fromLabel = linkCfg.fromLabel;
    const toLabel = linkCfg.toLabel;
    if (!fromLabel && !toLabel) return '';
    const color = linkCfg.color || '#01a982';
    const a = Math.atan2(y2 - y1, x2 - x1);
    // Perpendicular offset for label placement (above the line)
    const px = Math.sin(a) * 10, py = -Math.cos(a) * 10;
    // Inset along the line from the endpoints
    const dx = Math.cos(a) * 20, dy = Math.sin(a) * 20;
    let s = '';
    if (fromLabel) {
      s += `<g opacity="${op}">` +
        `<rect x="${x1 + dx + px - 22}" y="${y1 + dy + py - 8}" width="44" height="14" rx="3" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".4"/>` +
        `<text x="${x1 + dx + px}" y="${y1 + dy + py + 3}" text-anchor="middle" fill="${color}" font-size="7" font-weight="600" opacity=".9">${fromLabel}</text></g>`;
    }
    if (toLabel) {
      s += `<g opacity="${op}">` +
        `<rect x="${x2 - dx + px - 22}" y="${y2 - dy + py - 8}" width="44" height="14" rx="3" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".4"/>` +
        `<text x="${x2 - dx + px}" y="${y2 - dy + py + 3}" text-anchor="middle" fill="${color}" font-size="7" font-weight="600" opacity=".9">${toLabel}</text></g>`;
    }
    return s;
  }

  /**
   * Render a link by resolving its from/to positions and calling the right renderer.
   */
  /**
   * Build an SVG path string through from → waypoints → to.
   * Supports 'orthogonal' (right-angle) and default (straight segments) lineStyles.
   */
  _buildLinkPath(from, to, waypoints, lineStyle, cornerRadius) {
    const pts = [from, ...(waypoints || []), to];
    if (lineStyle === 'orthogonal') {
      // Right-angle routing between consecutive points
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const mx = pts[i].x, my = pts[i-1].y;
        d += ` L${mx},${my} L${pts[i].x},${pts[i].y}`;
      }
      return d;
    }
    if (lineStyle === 'curved') {
      // Curved path — outward-bowing quadratic bezier for 2 points, Catmull-Rom for 3+
      if (pts.length === 2) {
        const mx = (pts[0].x + pts[1].x) / 2;
        const my = (pts[0].y + pts[1].y) / 2;
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const len = Math.hypot(dx, dy) || 1;
        const r = Math.abs(cornerRadius || 20);
        const bulge = Math.min(r, len * 0.15);
        // Negative cornerRadius = force opposite curve direction
        // Positive/default = auto-detect outward direction
        const autoSign = dx > 0 ? -1 : dx < 0 ? 1 : (dy > 0 ? 1 : -1);
        const sign = cornerRadius < 0 ? -autoSign : autoSign;
        const nx = -dy / len * bulge * sign;
        const ny = dx / len * bulge * sign;
        return `M${pts[0].x},${pts[0].y} Q${mx+nx},${my+ny} ${pts[1].x},${pts[1].y}`;
      }
      // 3+ points: Catmull-Rom spline
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const t = 0.5;
        const cp1x = p1.x + (p2.x - p0.x) / (6 / t);
        const cp1y = p1.y + (p2.y - p0.y) / (6 / t);
        const cp2x = p2.x - (p3.x - p1.x) / (6 / t);
        const cp2y = p2.y - (p3.y - p1.y) / (6 / t);
        d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
      }
      return d;
    }
    // Default: straight segments through waypoints
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  }

  _renderLinkSVG(linkCfg, stepId, phaseNum) {
    const from = this._pos(linkCfg.from);
    const to = this._pos(linkCfg.to);
    const op = linkCfg.opacity != null ? linkCfg.opacity : Math.min(this._dimFor(linkCfg.from), this._dimFor(linkCfg.to));
    const color = linkCfg.color || '#01a982';
    const _flow = { speed: linkCfg.flowSpeed, particles: linkCfg.flowParticles, reverse: linkCfg.reverseFlow };
    let svg = '';

    // Waypoint-aware path: if link has waypoints, build path through them
    const hasWaypoints = linkCfg.waypoints && linkCfg.waypoints.length > 0;
    const waypointPath = hasWaypoints
      ? this._buildLinkPath(from, to, linkCfg.waypoints, linkCfg.lineStyle, linkCfg.cornerRadius)
      : null;

    // Smart Link Routing (Goal 1c): check for routed path (only when no explicit waypoints)
    const routedPath = !hasWaypoints && (linkCfg.type === 'line' || linkCfg.type === 'tunnel')
      ? this._routeLink(from, to, linkCfg.id) : null;

    switch (linkCfg.type) {
      case 'line':
        if (waypointPath) {
          svg = this._renderFlow(stepId, phaseNum, waypointPath, color, null, null, null, op, false);
        } else if (routedPath) {
          // Use flow renderer for routed paths (supports curves)
          svg = this._renderFlow(stepId, phaseNum, routedPath, color, null, null, null, op, false);
        } else {
          svg = this._renderLine(stepId, phaseNum, from.x, from.y, to.x, to.y, color, op, linkCfg.dashed, linkCfg.strokeWidth);
        }
        break;
      case 'tunnel': {
        const tunnelPath = waypointPath || routedPath || `M${from.x},${from.y} L${to.x},${to.y}`;
        const tmx = (from.x + to.x) / 2, tmy = (from.y + to.y) / 2;
        const ta = Math.atan2(to.y - from.y, to.x - from.x);
        const tloX = linkCfg.labelOffset?.x || 0, tloY = linkCfg.labelOffset?.y || 0;
        const tlx = tmx + Math.sin(ta) * 16 + Math.cos(ta) * tloX + Math.sin(ta) * tloY;
        const tly = tmy - Math.cos(ta) * 16 + Math.sin(ta) * tloX - Math.cos(ta) * tloY;
        svg = this._renderTunnel(stepId, phaseNum, tunnelPath, color, linkCfg.label, tlx, tly, op, linkCfg.dots !== false, _flow);
        break;
      }
      case 'wireguard': {
        if (waypointPath) {
          const mx = (from.x + to.x) / 2 + (linkCfg.labelOffset?.x || 0), my = (from.y + to.y) / 2 + (linkCfg.labelOffset?.y || 0);
          svg = this._renderFlow(stepId, phaseNum, waypointPath, '#65aef9', linkCfg.label, mx, my, op, linkCfg.dots !== false, _flow);
        } else {
          svg = this._renderWG(stepId, phaseNum, from.x, from.y, to.x, to.y, linkCfg.label, op, linkCfg.dots !== false, linkCfg.labelOffset, _flow);
        }
        break;
      }
      case 'flow': {
        const path = waypointPath || linkCfg.path || `M${from.x},${from.y} L${to.x},${to.y}`;
        const lpos = linkCfg.labelPos || {};
        const lo = linkCfg.labelOffset;
        svg = this._renderFlow(stepId, phaseNum, path, color, linkCfg.label, (lpos.x || 0) + (lo?.x || 0) || lpos.x, (lpos.y || 0) + (lo?.y || 0) || lpos.y, op, linkCfg.dots !== false, _flow);
        break;
      }
      case 'packet':
        svg = this._renderPacket(stepId, phaseNum, from.x, from.y, to.x, to.y, color, linkCfg.label, linkCfg.sublabel, op, linkCfg.labelOffset);
        break;
      case 'blocked':
        svg = this._renderBlocked(stepId, phaseNum, from.x, from.y, to.x, to.y, linkCfg.reason);
        break;
      case 'wifi':
        svg = this._renderWifi(stepId, phaseNum, from.x, from.y, to.x, to.y, color, linkCfg.label, op, linkCfg.labelOffset);
        break;
      case 'poe':
        svg = this._renderPoE(stepId, phaseNum, from.x, from.y, to.x, to.y, color, linkCfg.label, op, linkCfg.labelOffset);
        break;
      case 'optical':
        svg = this._renderOptical(stepId, phaseNum, from.x, from.y, to.x, to.y, color, linkCfg.label, op, linkCfg.labelOffset);
        break;
      default: {
        // Check for plugin link types
        const linkPlugin = TopologyDesigner._linkPlugins[linkCfg.type];
        if (linkPlugin) {
          const { show, anim, delay } = this._ph(stepId, phaseNum);
          if (!show) { svg = ''; break; }
          const ctx = {
            x1: from.x, y1: from.y, x2: to.x, y2: to.y,
            color, label: linkCfg.label, opacity: op,
            stepId, phaseNum, show, anim, delay,
            designer: this, linkCfg,
            animDot: (path, c, o, d) => this._animDot(path, c, o, d),
            glowFilter: this._glowForColor(color),
            dofFilter: op < 0.9 && this.step > 0 ? 'url(#tds-dof-blur)' : '',
          };
          const merged = { ...linkPlugin.defaults, ...linkCfg };
          svg = linkPlugin.render({ ...ctx, linkCfg: merged });
        } else {
          svg = this._renderLine(stepId, phaseNum, from.x, from.y, to.x, to.y, color, op);
        }
      }
    }

    // Append endpoint (port) labels if configured
    if (svg && (linkCfg.fromLabel || linkCfg.toLabel)) {
      svg += this._renderEndpointLabels(from.x, from.y, to.x, to.y, linkCfg, op);
    }

    return svg;
  }

  /* ══════════════════════════════════════════
     DECLARATIVE PHASE RENDERING
     Renders flow, label, badge, callout, blocked, rerender
     declared directly in phase config objects
     ══════════════════════════════════════════ */

  /**
   * Render declarative actions defined on a phase.
   * Each phase can declare one or more of:
   *   flow:     { path|through, color, label, labelPos, dots, dimIds, hideAfter }
   *   label:    { at, text, color, size, weight, offsetY } or [...]
   *   badge:    { at, text, color, width, height, offsetY } or [...]
   *   callout:  { x, y, w, h, lines: [{text,color,size,weight}], border, dimIds }
   *   blocked:  { from, to, reason }
   *   rerender: { node, type, x, y, cfg, label, sublabel }
   */
  _renderDeclarativePhase(step, phaseNum, phase) {
    let svg = '';

    // ── flow: animated traffic path ──
    if (phase.flow) {
      const flows = Array.isArray(phase.flow) ? phase.flow : [phase.flow];
      for (const f of flows) {
        const path = f.path || (f.through ? this.pathThrough(...f.through) : '');
        const dimIds = f.dimIds || [];
        const op = dimIds.length ? this._dimAll(...dimIds) : 1;
        const hideAfter = f.hideAfter;
        if (hideAfter && this._vis(hideAfter)) continue;
        // Compute label position: use explicit labelPos, or fall back to path midpoint
        let flowLx = f.labelPos?.x ?? null;
        let flowLy = f.labelPos?.y ?? null;
        if (f.label && flowLx == null && path) {
          // Extract midpoint from SVG path by parsing M/L coordinates
          const coords = [...path.matchAll(/[ML]\s*([\d.+-]+)[,\s]([\d.+-]+)/gi)];
          if (coords.length >= 2) {
            const first = coords[0], last = coords[coords.length - 1];
            flowLx = (parseFloat(first[1]) + parseFloat(last[1])) / 2;
            flowLy = (parseFloat(first[2]) + parseFloat(last[2])) / 2;
          } else if (coords.length === 1) {
            flowLx = parseFloat(coords[0][1]);
            flowLy = parseFloat(coords[0][2]);
          }
        }
        svg += this._renderFlow(step.id, phaseNum, path, f.color || '#01a982',
          f.label || null, flowLx, flowLy,
          op, f.dots !== false);
      }
    }

    // ── label: text positioned relative to a node/anchor ──
    if (phase.label) {
      const labels = Array.isArray(phase.label) ? phase.label : [phase.label];
      for (const l of labels) {
        const pos = this._posCached(l.at);
        const ox = l.offsetX || 0, oy = l.offsetY || 0;
        const op = l.dimIds ? this._dimAll(...l.dimIds) : this._dimFor(l.at);
        svg += this._pw(step.id, phaseNum, op,
          `<text x="${pos.x + ox}" y="${pos.y + oy}" text-anchor="${l.anchor || 'middle'}" fill="${l.color || '#b1b9be'}" font-size="${l.size || '7.5'}" font-weight="${l.weight || '400'}" opacity="${l.opacity || '.6'}">${_esc(l.text)}</text>`
        );
      }
    }

    // ── badge: glass-backed label anchored to a node ──
    if (phase.badge) {
      const badges = Array.isArray(phase.badge) ? phase.badge : [phase.badge];
      for (const b of badges) {
        const pos = this._posCached(b.at);
        const ox = b.offsetX || 0, oy = b.offsetY || 0;
        const bw = b.width || 128, bh = b.height || 22;
        const op = b.dimIds ? this._dimAll(...b.dimIds) : this._dimFor(b.at);
        const bc = b.border || b.color || 'rgba(255,255,255,.06)';
        svg += this._pw(step.id, phaseNum, op,
          `<rect x="${pos.x + ox - bw/2}" y="${pos.y + oy - bh/2}" width="${bw}" height="${bh}" rx="${b.rx || 6}" fill="url(#tds-labelGlass)" opacity=".94" stroke="${bc}" stroke-width=".5"/>` +
          `<text x="${pos.x + ox}" y="${pos.y + oy + (b.textOffsetY || 4)}" text-anchor="middle" fill="${b.color || '#b1b9be'}" font-size="${b.size || '7.5'}" font-weight="${b.weight || '700'}">${_esc(b.text)}</text>`
        );
      }
    }

    // ── callout: glass-backed multi-line box at absolute position ──
    if (phase.callout) {
      const callouts = Array.isArray(phase.callout) ? phase.callout : [phase.callout];
      for (const c of callouts) {
        const op = c.dimIds ? this._dimAll(...c.dimIds) : (c.opacity ?? 1);
        svg += this._renderCallout(step.id, phaseNum, c.x, c.y, c.w, c.h, c.lines, c.border, op);
      }
    }

    // ── blocked: X indicator between two points ──
    if (phase.blocked) {
      const b = phase.blocked;
      const from = this._posCached(b.from);
      const to = this._posCached(b.to);
      svg += this._renderBlocked(step.id, phaseNum,
        from.x + (b.fromOffset?.x || 0), from.y + (b.fromOffset?.y || 0),
        to.x + (b.toOffset?.x || 0), to.y + (b.toOffset?.y || 0),
        b.reason);
    }

    // ── rerender: re-render a node with different config (e.g., managed state) ──
    if (phase.rerender) {
      const rerenders = Array.isArray(phase.rerender) ? phase.rerender : [phase.rerender];
      for (const r of rerenders) {
        const pos = this._posCached(r.node);
        const op = this._dimFor(r.node);
        const hideAfter = r.hideAfter;
        if (hideAfter && this._vis(hideAfter)) continue;
        const nodeSvg = (TopologyDesigner.NODE_TYPES[r.type || 'host'] || (() => ''))(
          r.x ?? pos.x, r.y ?? pos.y, r.cfg || {}
        );
        let full = nodeSvg;
        if (r.label) {
          full += `<text x="${r.x ?? pos.x}" y="${(r.y ?? pos.y) + (r.labelOffset || 24)}" text-anchor="middle" fill="${r.labelColor || '#e6e8e9'}" font-size="10" font-weight="600">${_esc(r.label)}</text>`;
        }
        if (r.sublabel) {
          full += `<text x="${r.x ?? pos.x}" y="${(r.y ?? pos.y) + (r.sublabelOffset || 37)}" text-anchor="middle" fill="#7d8a92" font-size="7.5">${_esc(r.sublabel)}</text>`;
        }
        svg += this._pw(step.id, phaseNum, op, full);
      }
    }

    return svg;
  }

  /**
   * Build the render context object passed to onRender callbacks.
   * Now includes path helpers, dimAll, and cached pos.
   */
  _buildRenderContext(step) {
    return {
      step: this.step,
      stepId: step.id,
      vis: (id) => this._vis(id),
      ph: (id, pn) => this._ph(id, pn),
      pw: (id, pn, op, s) => this._pw(id, pn, op, s),
      dim: (id) => this._dimFor(id),
      dimAll: (...ids) => this._dimAll(...ids),
      pos: (id) => this._posCached(id),
      pathThrough: (...ids) => this.pathThrough(...ids),
      pathBetween: (a, b, o) => this.pathBetween(a, b, o),
      renderLine: (sid, pn, x1, y1, x2, y2, c, op, d) => this._renderLine(sid, pn, x1, y1, x2, y2, c, op, d),
      renderTunnel: (sid, pn, x1, y1, x2, y2, c, l, op, d) => this._renderTunnel(sid, pn, x1, y1, x2, y2, c, l, op, d),
      renderWG: (sid, pn, x1, y1, x2, y2, l, op, d) => this._renderWG(sid, pn, x1, y1, x2, y2, l, op, d),
      renderFlow: (sid, pn, p, c, l, lx, ly, op, d) => this._renderFlow(sid, pn, p, c, l, lx, ly, op, d),
      renderBlocked: (sid, pn, x1, y1, x2, y2, r) => this._renderBlocked(sid, pn, x1, y1, x2, y2, r),
      renderPoE: (sid, pn, x1, y1, x2, y2, c, l, op) => this._renderPoE(sid, pn, x1, y1, x2, y2, c, l, op),
      renderOptical: (sid, pn, x1, y1, x2, y2, c, l, op) => this._renderOptical(sid, pn, x1, y1, x2, y2, c, l, op),
      renderCallout: (sid, pn, x, y, w, h, lines, bc, op) => this._renderCallout(sid, pn, x, y, w, h, lines, bc, op),
      renderNode: (type, x, y, cfg) => {
        const r = TopologyDesigner.NODE_TYPES[type];
        return r ? r(x, y, cfg) : '';
      },
      reducedMotion: this.reducedMotion,
    };
  }

  /**
   * Main SVG render — called on every step change.
   * Iterates all steps and phases, renders nodes and links that should be visible.
   */
  _renderSVG() {
    this._clearPosCache(); // Reset position cache for this render cycle
    const vb = this.viewBox.split(' ').map(Number);
    const w = vb[2] || 1050, h = vb[3] || 700;
    let svg = this._svgDefs() + this._svgAmbient(w, h);

    // ── Zone annotation rectangles (render behind everything) ──
    // Step-aware: only render a zone if at least one of its member nodes is visible
    // Render parent zones first (behind), then child zones on top for nesting
    const zoneOrder = [];
    const visited = new Set();
    const addZoneDepthFirst = (zoneId) => {
      if (visited.has(zoneId)) return;
      visited.add(zoneId);
      const zone = this._zones.get(zoneId);
      if (!zone) return;
      // Render parent before child
      if (zone.parentZone && this._zones.has(zone.parentZone)) {
        addZoneDepthFirst(zone.parentZone);
      }
      zoneOrder.push(zoneId);
    };
    for (const [zoneId] of this._zones) addZoneDepthFirst(zoneId);

    for (const zoneId of zoneOrder) {
      const zone = this._zones.get(zoneId);
      // Collect all descendant nodes for visibility check
      const allNodes = this._getZoneNodesRecursive(zoneId);
      if (allNodes.length > 0 && this._steps.length > 0) {
        const hasVisibleNode = allNodes.some(nId => {
          const sp = this._findShowPhase(nId);
          return sp && this.step >= this._stepIndex[sp.stepId];
        });
        if (!hasVisibleNode) continue;
      }
      svg += this._renderZoneRect(zone);
    }

    // Track per-step flow animation overrides (persist across phases/steps)
    const _flowOverrides = new Map(); // linkId → { animateFlow, reverseFlow, flowSpeed, flowColor }

    // Iterate through all steps and their phases
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (let p = 0; p < step.phases.length; p++) {
        const phase = step.phases[p];
        if (!phase.show) continue;

        // Accumulate flow actions from this phase
        if (phase.flowActions) {
          for (const fa of phase.flowActions) {
            _flowOverrides.set(fa.linkId, { ..._flowOverrides.get(fa.linkId), ...fa });
          }
        }

        // Sort elements by zOrder (lower renders first = behind, higher renders last = in front)
        const sortedShow = [...phase.show].sort((a, b) => {
          const zA = (this._nodes.get(a) || this._links.get(a) || {}).zOrder || 0;
          const zB = (this._nodes.get(b) || this._links.get(b) || {}).zOrder || 0;
          return zA - zB;
        });
        // Evaluate conditional logic on this phase
        this._evaluatePhaseConditions(phase);

        for (const elemId of sortedShow) {
          // Blast radius dimming in security mode
          let blastDim = 1;
          if (this._securityMode && this._blastRadiusNode) {
            const reachable = this.getBlastRadius(this._blastRadiusNode);
            blastDim = reachable.has(elemId) ? 1 : 0.12;
          }

          // Ghosting: check if element belongs to a previous act
          const ghostOp = this._getGhostState(elemId);

          // Check if it's a node
          const nodeCfg = this._nodes.get(elemId);
          if (nodeCfg) {
            // Layer opacity
            const layerOp = this._getLayerOpacity(this._getElementLayer(elemId));
            if (layerOp <= 0) continue; // skip hidden layer elements
            // Honor per-node opacity in this render path (the other path already
            // does at _renderNodeSVG); keeps node opacity a real document field.
            let op = Math.min(this._dimFor(elemId), blastDim) * layerOp * (nodeCfg.opacity != null ? nodeCfg.opacity : 1);
            const halo = this._haloForNode(nodeCfg);

            // Resolve overlay cloud spans to actual positions BEFORE rendering
            if (nodeCfg.type === 'overlayCloud' && nodeCfg.spans) {
              nodeCfg._resolvedSpans = nodeCfg.spans.map(id => this._pos(id));
            }

            let nodeSvg = this._renderNodeSVG(nodeCfg);

            // Add label if configured
            if (nodeCfg.label && nodeCfg.type !== 'cloud' && nodeCfg.type !== 'idcard' && nodeCfg.type !== 'overlayCloud') {
              const labelY = nodeCfg.labelY || (nodeCfg.y + (nodeCfg.labelOffset || 24));
              nodeSvg += this._renderNodeLabel(nodeCfg.x, labelY, nodeCfg.label, nodeCfg.sublabel, nodeCfg.labelColor);
            }

            // Show Node ID if enabled
            if (this.showNodeIds) {
              nodeSvg += `<text x="${nodeCfg.x}" y="${nodeCfg.y - (nodeCfg.type === 'cloud' ? 42 : 20)}" text-anchor="middle" fill="#fc6161" font-size="7" font-weight="700" opacity=".6">[${elemId}]</text>`;
            }

            // Add side label if configured
            if (nodeCfg.sideLabel) {
              const sl = nodeCfg.sideLabel;
              nodeSvg += this._renderSideLabel(sl.x, sl.y, sl.label, sl.sublabel, sl.color || '#01a982', sl.anchor);
            }

            // Add zone indicator if configured
            if (nodeCfg.zoneIndicator) {
              nodeSvg += this._renderZoneIndicator(nodeCfg.x, nodeCfg.y, nodeCfg.zoneIndicator);
            }

            // Add zone label if configured
            if (nodeCfg.zoneLabel) {
              svg += this._renderZoneLabel(step.id, p, nodeCfg.x, nodeCfg.y + (nodeCfg.zoneLabelOffset || 22), nodeCfg.zoneLabel.text, nodeCfg.zoneLabel.color, op);
            }

            // Temporal Digital Twin: state overlay
            nodeSvg += this._renderTemporalBadge(nodeCfg.x, nodeCfg.y, elemId);
            const temporal = this._getTemporalEffect(elemId);

            nodeSvg = this._focusWrap(elemId, halo, nodeSvg);

            // Apply temporal filter wrapping
            if (temporal.filter) {
              nodeSvg = `<g ${temporal.filter ? `filter="${temporal.filter}"` : ''}>${nodeSvg}</g>`;
            }

            // Apply ghosting
            const iso3dAttr = nodeCfg.type && typeof nodeCfg.type === 'string' && nodeCfg.type.startsWith('iso:') ? ' data-tds-iso3d="true"' : '';
            if (ghostOp !== null) {
              op = ghostOp;
              svg += this._pw(step.id, p, op, `<g data-tds-node="${elemId}"${iso3dAttr} style="cursor:pointer" filter="url(#tds-ghost)">${nodeSvg}</g>`);
            } else {
              svg += this._pw(step.id, p, op, `<g data-tds-node="${elemId}"${iso3dAttr} style="cursor:pointer">${nodeSvg}</g>`);
            }
            continue;
          }

          // Check if it's a link
          const linkCfg = this._links.get(elemId);
          if (linkCfg) {
            // Layer opacity for links
            const linkLayerOp = this._getLayerOpacity(this._getElementLayer(elemId));
            if (linkLayerOp <= 0) continue; // skip hidden layer elements
            const linkSvg = this._renderLinkSVG(linkCfg, step.id, p);
            if (linkSvg) {
              let linkOpacity = (ghostOp !== null ? ghostOp : blastDim) * linkLayerOp;
              const temporal = this._getTemporalEffect(elemId);
              let wrappedLink = linkSvg;
              if (temporal.filter) {
                wrappedLink = `<g filter="${temporal.filter}">${linkSvg}</g>`;
              }
              if (ghostOp !== null) {
                svg += `<g data-tds-link="${elemId}" style="cursor:pointer" filter="url(#tds-ghost)" opacity="${ghostOp}">${wrappedLink}</g>`;
              } else {
                svg += `<g data-tds-link="${elemId}" style="cursor:pointer">${wrappedLink}</g>`;
              }
              // Security violation overlay
              svg += this._renderViolationOverlay(elemId);
            }
            continue;
          }
        }

        // Render any custom SVG for this phase
        if (phase.custom) {
          const { show: pShow, anim, delay } = this._ph(step.id, p);
          if (pShow && typeof phase.custom === 'function') {
            svg += phase.custom({
              step: this.step,
              stepId: step.id,
              phaseNum: p,
              vis: (id) => this._vis(id),
              ph: (id, pn) => this._ph(id, pn),
              pw: (id, pn, op, s) => this._pw(id, pn, op, s),
              dim: (id) => this._dimFor(id),
              dimAll: (...ids) => this._dimAll(...ids),
              pos: (id) => this._posCached(id),
              pathThrough: (...ids) => this.pathThrough(...ids),
              pathBetween: (a, b, o) => this.pathBetween(a, b, o),
              anim, delay,
              reducedMotion: this.reducedMotion,
            });
          } else if (pShow && typeof phase.custom === 'string') {
            svg += this._pw(step.id, p, 1, phase.custom);
          }
        }

        // ── Declarative Phase Actions ──
        // Render flows, labels, badges, callouts, blocked indicators, and
        // node re-renders declared directly in the phase config — no onRender needed.
        svg += this._renderDeclarativePhase(step, p, phase);
      }

      // Per-step flow animation overrides — render flow particles for active overrides
      if (_flowOverrides.size > 0) {
        const lastPhaseIdx = step.phases.length - 1;
        for (const [linkId, fo] of _flowOverrides) {
          if (!fo.animateFlow) continue;
          const linkCfg = this._links.get(linkId);
          if (!linkCfg) continue;
          const from = this._pos(linkCfg.from);
          const to = this._pos(linkCfg.to);
          if (!from || !to) continue;
          const path = linkCfg.path || `M${from.x},${from.y} L${to.x},${to.y}`;
          const flowColor = fo.flowColor || linkCfg.color || '#01a982';
          const flowSpeed = fo.flowSpeed || 2;
          const rev = fo.reverseFlow ? 'keyPoints="1;0" keyTimes="0;1"' : '';
          const flowCount = 3;
          let flowSvg = '';
          for (let fi = 0; fi < flowCount; fi++) {
            flowSvg += `<circle r="3" fill="${flowColor}" opacity=".7" filter="url(#tds-bloom)">` +
              `<animateMotion dur="${flowSpeed + fi * 0.5}s" repeatCount="indefinite" begin="${fi * 0.4}s" ${rev} path="${path}"/>` +
              `</circle>`;
          }
          svg += this._pw(step.id, lastPhaseIdx, 1, flowSvg);
        }
      }

      // Step-level custom render hook
      if (step.onRender) {
        const ctx = this._buildRenderContext(step);
        const extra = step.onRender(ctx);
        if (extra) svg += extra;
      }
    }

    // Render flow paths (animated overlays)
    if (this._flowPaths.size > 0 && this.step > 0) {
      for (const [fpId, fp] of this._flowPaths) {
        // Check layer visibility
        const layerOp = this._getLayerOpacity(fp.layer || 'physical');
        if (layerOp <= 0) continue;

        // Build SVG path through waypoints
        const waypoints = fp.waypoints || [];
        if (waypoints.length < 2) continue;

        const points = waypoints.map(wId => this._posCached(wId)).filter(Boolean);
        if (points.length < 2) continue;

        let pathD = `M${points[0].x},${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
          pathD += ` L${points[i].x},${points[i].y}`;
        }

        const color = fp.color || '#01a982';
        const width = fp.width || 2;
        const fpOpacity = (fp.opacity != null ? fp.opacity : 0.8) * layerOp;
        const _speedMap = { slow: 4, medium: 2.5, fast: 1.2 };
        const speed = (typeof fp.speed === 'string' ? _speedMap[fp.speed] : fp.speed) || 2.5;
        const animation = fp.animation || 'particles';
        const direction = fp.direction || 'forward';
        const rev = direction === 'reverse' ? 'keyPoints="1;0" keyTimes="0;1"' : '';

        let fpSvg = '';

        // Glow underlay
        fpSvg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${width * 4}" opacity=".04" filter="url(#tds-glow)"/>`;

        // Main stroke
        if (animation === 'dashed') {
          fpSvg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="8 5" opacity="${fpOpacity}"/>`;
        } else if (animation === 'pulse') {
          fpSvg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${fpOpacity}">` +
            `<animate attributeName="opacity" values="${fpOpacity};${fpOpacity * 0.3};${fpOpacity}" dur="${speed}s" repeatCount="indefinite"/>` +
            `</path>`;
        } else {
          // particles (default)
          fpSvg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="5 4" opacity="${fpOpacity * 0.4}"/>`;
          if (!this.reducedMotion) {
            const particleCount = 3;
            for (let pi = 0; pi < particleCount; pi++) {
              fpSvg += `<circle r="${width + 1}" fill="${color}" opacity=".7" filter="url(#tds-bloom)">` +
                `<animateMotion dur="${speed + pi * 0.5}s" repeatCount="indefinite" begin="${pi * 0.4}s" ${rev} path="${pathD}"/>` +
                `</circle>`;
            }
            if (direction === 'bidirectional') {
              for (let pi = 0; pi < particleCount; pi++) {
                fpSvg += `<circle r="${width + 1}" fill="${color}" opacity=".5" filter="url(#tds-bloom)">` +
                  `<animateMotion dur="${speed + pi * 0.5}s" repeatCount="indefinite" begin="${pi * 0.4}s" keyPoints="1;0" keyTimes="0;1" path="${pathD}"/>` +
                  `</circle>`;
              }
            }
          }
        }

        // Label at midpoint
        if (fp.label) {
          const midIdx = Math.floor(points.length / 2);
          const mx = midIdx > 0 ? (points[midIdx - 1].x + points[midIdx].x) / 2 : points[0].x;
          const my = midIdx > 0 ? (points[midIdx - 1].y + points[midIdx].y) / 2 : points[0].y;
          fpSvg += `<rect x="${mx - 50}" y="${my - 10}" width="100" height="20" rx="5" fill="url(#tds-labelGlass)" stroke="rgba(255,255,255,.06)" stroke-width=".5"/>` +
            `<text x="${mx}" y="${my + 4}" text-anchor="middle" fill="${color}" font-size="8" font-weight="600">${_esc(fp.label)}</text>`;
        }

        svg += `<g data-tds-flowpath="${fpId}" opacity="${fpOpacity}">${fpSvg}</g>`;
      }
    }

    // Render policy markers (badges on nodes)
    if (this._policyMarkers.size > 0 && this.step > 0) {
      // Marker type icons
      const _mIcons = { inspect: '\u{1F50D}', allow: '\u2713', deny: '\u2715', redirect: '\u21AA', encrypt: '\u{1F512}', decrypt: '\u{1F513}', nat: '\u21C4', 'load-balance': '\u2442', log: '\u{1F441}' };
      // Compute a marker's (x,y) from its alignment + stacking index relative
      // to the node centre. Half-extents come from _getNodeAABB.
      const _markerPos = (nodeCfg, align, idx) => {
        const ab = this._getNodeAABB(nodeCfg);
        const hw = ab.w / 2, hh = ab.h / 2;
        const margin = 14, gap = 22;
        const a = align || 'NE';
        let cx, cy, sdx = 1, sdy = 0;
        switch (a) {
          case 'N':  cx = nodeCfg.x;             cy = nodeCfg.y - hh - margin; sdx = 1;  sdy = 0; break;
          case 'NE': cx = nodeCfg.x + hw + margin; cy = nodeCfg.y - hh - margin; sdx = 1;  sdy = 0; break;
          case 'E':  cx = nodeCfg.x + hw + margin; cy = nodeCfg.y;              sdx = 0;  sdy = 1; break;
          case 'SE': cx = nodeCfg.x + hw + margin; cy = nodeCfg.y + hh + margin; sdx = 1;  sdy = 0; break;
          case 'S':  cx = nodeCfg.x;             cy = nodeCfg.y + hh + margin; sdx = 1;  sdy = 0; break;
          case 'SW': cx = nodeCfg.x - hw - margin; cy = nodeCfg.y + hh + margin; sdx = -1; sdy = 0; break;
          case 'W':  cx = nodeCfg.x - hw - margin; cy = nodeCfg.y;              sdx = 0;  sdy = 1; break;
          case 'NW': cx = nodeCfg.x - hw - margin; cy = nodeCfg.y - hh - margin; sdx = -1; sdy = 0; break;
          case 'C':  cx = nodeCfg.x;             cy = nodeCfg.y;              sdx = 1;  sdy = 0; break;
          default:   cx = nodeCfg.x + hw + margin; cy = nodeCfg.y - hh - margin;
        }
        return { x: cx + sdx * gap * idx, y: cy + sdy * gap * idx };
      };
      // Group markers by (node, align) for stacking
      const byNodeAlign = new Map();
      for (const [mId, m] of this._policyMarkers) {
        const key = m.nodeId + '|' + (m.align || 'NE');
        if (!byNodeAlign.has(key)) byNodeAlign.set(key, []);
        byNodeAlign.get(key).push([mId, m]);
      }
      for (const [, markers] of byNodeAlign) {
        markers.forEach(([mId, m], idx) => {
          const nodeCfg = this._nodes.get(m.nodeId);
          if (!nodeCfg) return;
          const layerOp = this._getLayerOpacity(m.layer || nodeCfg.layer || 'physical');
          if (layerOp <= 0) return;
          const p = _markerPos(nodeCfg, m.align, idx);
          const mx = p.x, my = p.y;
          const color = m.color || '#65aef9';
          const icon = m.icon || _mIcons[m.type] || '\u2022';
          let mSvg = `<circle cx="${mx}" cy="${my}" r="10" fill="rgba(0,0,0,.6)" stroke="${color}" stroke-width="1"/>`;
          mSvg += `<text x="${mx}" y="${my + 4}" text-anchor="middle" fill="${color}" font-size="10" font-weight="700">${icon}</text>`;
          if (m.label) {
            mSvg += `<text x="${mx}" y="${my + 20}" text-anchor="middle" fill="${color}" font-size="6" font-weight="600" opacity=".8">${_esc(m.label)}</text>`;
          }
          svg += `<g data-tds-marker="${mId}" opacity="${layerOp}">${mSvg}</g>`;
        });
      }
    }

    // Render visible anchor/waypoint handles (small draggable diamonds)
    // Only show anchors after step 0 to keep canvas blank for progressive reveal
    if (this.step > 0) {
      for (const [id, pos] of this._anchors) {
        svg += `<g data-tds-anchor="${id}" style="cursor:grab">` +
          `<circle cx="${pos.x}" cy="${pos.y}" r="6" fill="rgba(101,174,249,.15)" stroke="#65aef9" stroke-width=".5" opacity=".4"/>` +
          `<circle cx="${pos.x}" cy="${pos.y}" r="2" fill="#65aef9" opacity=".6"/>` +
          (this.showNodeIds ? `<text x="${pos.x + 8}" y="${pos.y + 3}" fill="#65aef9" font-size="6" opacity=".5">${id}</text>` : '') +
          `</g>`;
      }
    }

    return svg;
  }

  /* ══════════════════════════════════════════
     DOM SCAFFOLDING & MOUNT
     Generates the full UI shell
     ══════════════════════════════════════════ */

  /** Mount the topology designer into a container element */
  mount(containerId) {
    this._buildIndex();
    this._containerId = containerId;
    const container = document.getElementById(containerId);
    if (!container) { console.error(`Container #${containerId} not found`); return this; }

    container.className = 'tds-root';
    container.innerHTML = this._scaffoldHTML();
    this._mounted = true;
    this._bindEvents();
    this._el = container;
    // Auto-detect theme
    const savedTheme = localStorage.getItem('tds-theme');
    const osPref = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    this.setTheme(savedTheme || osPref);
    this._loadURL();
    this._buildPips();
    this._buildSidebar();
    this._applyCSSTimings();
    this.render();
    return this;
  }

  /** Push drawDuration and fadeDuration into CSS custom properties so
      keyframe animations and transitions pick up the current values. */
  _applyCSSTimings() {
    const root = document.documentElement;
    root.style.setProperty('--tds-phase-ms', this.phaseMs + 'ms');
    root.style.setProperty('--tds-transition', this.fadeDuration + 's ease');
    root.style.setProperty('--tds-transition-fast', Math.max(0.1, this.fadeDuration * 0.64).toFixed(2) + 's ease');
    root.style.setProperty('--tds-draw-duration', this.drawDuration + 's');
  }

  _scaffoldHTML() {
    return `
<div class="tds-topbar">
  <div class="tds-brand-lockup" aria-label="Topology Studio">
    <img class="tds-brand-mark" src="assets/brand/topology_studio_icon.png" alt="" loading="lazy" decoding="async">
    <div class="tds-brand-copy">
      <h1>${_esc(this.title)}</h1>
      ${this.subtitle ? `<p class="tds-sub">${_esc(this.subtitle)}</p>` : ''}
    </div>
  </div>
</div>
<div class="tds-main">
  <div class="tds-sidebar" id="tds-sidebar"></div>
  <div class="tds-right">
    <div class="tds-toolbar">
      <div class="tds-pips" id="tds-progress"></div>
      <div class="tds-step-counter" id="tds-stepCounter"></div>
      <div class="tds-progress-bar" id="tds-progressBar"><div class="tds-progress-bar-fill" id="tds-progressFill" style="width:0%"></div></div>
      <div class="tds-step-label" id="tds-stepLabel"><span style="font-size:10px;color:var(--tds-muted2)">Press Play or step through →</span></div>
      <div class="tds-toolgroup">
        <select class="tds-select" id="tds-modeSel" title="Manual: step through one-by-one with Next/Prev buttons. Auto: steps advance automatically at the set speed. Presenter: keyboard-driven, optimized for live demos."><option value="manual">Manual</option><option value="auto">Auto</option><option value="presenter">Presenter</option></select>
        <div class="tds-range" id="tds-speedRange" title="Auto-play speed"><span style="font-size:9px;color:var(--tds-muted)">Speed</span><input id="tds-speed" type="range" min="2000" max="7000" step="200" value="${this.speedMs}" /><span id="tds-speedLbl" style="font-size:9px;color:var(--tds-muted)">${(this.speedMs/1000).toFixed(1)}s</span></div>
        <button class="tds-mini-btn tds-tuning-toggle" id="tds-tuningBtn" title="Show/hide timing controls">Tuning ▸</button>
        <div class="tds-tuning-group collapsed" id="tds-tuningGroup">
          <div class="tds-range" title="Phase stagger delay — time between successive phase reveals within a step"><span style="font-size:9px;color:var(--tds-muted)">Phase delay</span><input id="tds-phaseMs" type="range" min="100" max="1500" step="50" value="${this.phaseMs}" /><span id="tds-phaseLbl" style="font-size:9px;color:var(--tds-muted)">${(this.phaseMs/1000).toFixed(1)}s</span></div>
          <div class="tds-range" title="How long the stroke draw-in animation takes for lines and links"><span style="font-size:9px;color:var(--tds-muted)">Draw speed</span><input id="tds-drawDur" type="range" min="0.2" max="2.0" step="0.1" value="${this.drawDuration}" /><span id="tds-drawLbl" style="font-size:9px;color:var(--tds-muted)">${this.drawDuration.toFixed(1)}s</span></div>
          <div class="tds-range" title="How long elements take to fade in when a new phase is revealed"><span style="font-size:9px;color:var(--tds-muted)">Fade in</span><input id="tds-fadeDur" type="range" min="0.1" max="1.5" step="0.05" value="${this.fadeDuration}" /><span id="tds-fadeLbl" style="font-size:9px;color:var(--tds-muted)">${this.fadeDuration.toFixed(2)}s</span></div>
          <select class="tds-select" id="tds-temporalSel" title="Temporal mode: Design (planned), Operational (live metrics), Incident (historical)"><option value="design">Design</option><option value="operational">Operational</option><option value="incident">Incident</option></select>
        </div>
        <div class="tds-feature-toggles">
          <button class="tds-mini-btn" id="tds-isoBtn" title="Toggle isometric tilt view (3D)" aria-pressed="false">Tilt</button>
          <button class="tds-mini-btn" id="tds-secBtn" title="Toggle security analysis mode" aria-pressed="false">Security</button>
          ${this._glossary.length ? `<button class="tds-mini-btn" id="tds-glossBtn" title="Glossary (G)">Glossary</button>` : ''}
          <span id="tds-mode-indicator" class="tds-mode-toggle" title="Click to toggle Link/Select mode (Esc to exit)">SELECT</span>
          <button class="tds-mini-btn" id="tds-shortcutsBtn" title="Keyboard shortcuts (?)">?</button>

          <button class="tds-mini-btn" id="tds-themeBtn" title="Toggle light/dark theme">☀️</button>
          <button class="tds-mini-btn primary" id="tds-presentBtn" title="Enter presentation mode (fullscreen) — perfect for customer demos and recordings">▶ Present</button>
          <button class="tds-mini-btn" id="tds-exportBtn" title="Export as PNG/SVG/PDF">Export</button>
          <button class="tds-mini-btn" id="tds-layoutEditBtn" title="Toggle layout edit mode — drag nodes to reposition" aria-pressed="false">✛ Layout</button>
          <button class="tds-mini-btn" id="tds-copyPosBtn" title="Copy all node positions to clipboard" style="display:none">📋 Positions</button>
        </div>
      </div>
    </div>
    <div class="tds-security-banner" id="tds-secBanner">⚠ Click a node to visualize blast radius. Press Security again to exit.</div>
    <div class="tds-canvas-row">
      <div class="tds-canvas"><svg id="tds-diagram" viewBox="${this.viewBox}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%" role="img" aria-label="${_esc(this.title)} — network topology diagram"></svg></div>
      <div class="tds-narrator" id="tds-narrator" role="complementary" aria-label="Step narrator"></div>
      <div id="tds-live-region" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)"></div>
    </div>
    <div class="tds-controls">
      <button class="tds-btn" id="tds-resetBtn" aria-label="Reset to beginning">⟲ Reset</button>
      <button class="tds-btn" id="tds-prevBtn" aria-label="Previous step">◂ Prev</button>
      <div class="tds-step-counter" id="tds-stepCounterCtrl" style="font-size:11px"></div>
      <button class="tds-btn play" id="tds-playBtn" aria-label="Play presentation">▶ Play</button>
      <button class="tds-btn" id="tds-nextBtn" aria-label="Next step">Next ▸</button>
    </div>
  </div>
</div>
${this._glossary.length ? `<div class="tds-modal-backdrop" id="tds-modalBg" role="dialog" aria-modal="true"><div class="tds-modal"><div class="tds-mhead"><h3>Glossary</h3><div class="tds-mini-btn tds-mclose" id="tds-modalClose">✕</div></div><div class="tds-mbody" id="tds-glossaryBody"></div></div></div>` : ''}
<div class="tds-shortcuts-backdrop" id="tds-shortcutsBg">
  <div class="tds-shortcuts-modal">
    <div class="tds-mhead"><h3>Keyboard Shortcuts</h3><div class="tds-mini-btn tds-mclose" id="tds-shortcutsClose" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:14px;border-radius:8px">✕</div></div>
    <div id="tds-shortcutsBody">
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Play / Pause</span><div class="tds-shortcut-key"><span class="tds-kbd">Space</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Next step</span><div class="tds-shortcut-key"><span class="tds-kbd">→</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Previous step</span><div class="tds-shortcut-key"><span class="tds-kbd">←</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">First step</span><div class="tds-shortcut-key"><span class="tds-kbd">Home</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Last step</span><div class="tds-shortcut-key"><span class="tds-kbd">End</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Toggle node IDs</span><div class="tds-shortcut-key"><span class="tds-kbd">I</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Toggle narrator</span><div class="tds-shortcut-key"><span class="tds-kbd">N</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Open glossary</span><div class="tds-shortcut-key"><span class="tds-kbd">G</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Exit link mode</span><div class="tds-shortcut-key"><span class="tds-kbd">Escape</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Show shortcuts</span><div class="tds-shortcut-key"><span class="tds-kbd">?</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Toggle layout edit mode</span><div class="tds-shortcut-key"><span class="tds-kbd">L</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Enter presentation mode</span><div class="tds-shortcut-key"><span class="tds-kbd">F5</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Exit presentation</span><div class="tds-shortcut-key"><span class="tds-kbd">Escape</span></div></div>
      <div class="tds-shortcut-row"><span class="tds-shortcut-desc">Toggle fullscreen (presenting)</span><div class="tds-shortcut-key"><span class="tds-kbd">F</span></div></div>
    </div>
  </div>
</div>`;
  }

  _bindEvents() {
    const self = this;
    const $ = id => document.getElementById(id);

    $('tds-resetBtn').onclick = () => self.reset();
    $('tds-prevBtn').onclick  = () => self.prev();
    $('tds-playBtn').onclick  = () => self.playing ? self.pause() : self.play();
    $('tds-nextBtn').onclick  = () => self.next();

    const presentBtn = $('tds-presentBtn');
    if (presentBtn) {
      presentBtn.onclick = () => {
        try { localStorage.setItem('tds-seen-present-nudge', '1'); } catch (e) {}
        const n = document.getElementById('tds-present-nudge');
        if (n) n.remove();
        self.present();
      };

      // First-visit nudge — shown once per browser to teach the primary action.
      let seen;
      try { seen = localStorage.getItem('tds-seen-present-nudge'); } catch (e) { seen = '1'; }
      if (!seen) {
        requestAnimationFrame(() => {
          const btnRect = presentBtn.getBoundingClientRect();
          if (!btnRect.width) return;
          const nudge = document.createElement('div');
          nudge.className = 'tds-present-nudge';
          nudge.id = 'tds-present-nudge';
          nudge.innerHTML = `
            <div>Click <strong>▶ Present</strong> for a clean fullscreen view — perfect for customer demos.</div>
            <button type="button" id="tds-nudge-dismiss">Got it</button>`;
          document.body.appendChild(nudge);
          const nRect = nudge.getBoundingClientRect();
          nudge.style.top = Math.round(btnRect.bottom + 10) + 'px';
          nudge.style.left = Math.round(Math.max(8, btnRect.right - nRect.width)) + 'px';
          const dismiss = () => {
            try { localStorage.setItem('tds-seen-present-nudge', '1'); } catch (e) {}
            nudge.remove();
          };
          document.getElementById('tds-nudge-dismiss').onclick = dismiss;
          setTimeout(dismiss, 12000);
        });
      }
    }

    $('tds-modeSel').addEventListener('change', e => {
      self.mode = e.target.value;
      if (self.reducedMotion) self.mode = 'manual';
      self.playing = false; clearTimeout(self._timer);
      self.render();
    });

    $('tds-speed').addEventListener('input', e => {
      self.speedMs = parseInt(e.target.value, 10);
      $('tds-speedLbl').textContent = (self.speedMs/1000).toFixed(1) + 's';
    });

    $('tds-phaseMs').addEventListener('input', e => {
      self.phaseMs = parseInt(e.target.value, 10);
      $('tds-phaseLbl').textContent = (self.phaseMs / 1000).toFixed(1) + 's';
      self._applyCSSTimings();
      self.render();
    });

    $('tds-drawDur').addEventListener('input', e => {
      self.drawDuration = parseFloat(e.target.value);
      $('tds-drawLbl').textContent = self.drawDuration.toFixed(1) + 's';
      self._applyCSSTimings();
      self.render();
    });

    $('tds-fadeDur').addEventListener('input', e => {
      self.fadeDuration = parseFloat(e.target.value);
      $('tds-fadeLbl').textContent = self.fadeDuration.toFixed(2) + 's';
      self._applyCSSTimings();
      self.render();
    });

    // Temporal mode selector
    const temporalSel = $('tds-temporalSel');
    if (temporalSel) {
      temporalSel.value = self.temporalMode;
      temporalSel.addEventListener('change', e => self.setTemporalMode(e.target.value));
    }

    // Isometric tilt toggle
    const isoBtn = $('tds-isoBtn');
    if (isoBtn) {
      isoBtn.onclick = () => {
        const on = self.toggleIsometric();
        isoBtn.classList.toggle('active', on);
        isoBtn.setAttribute('aria-pressed', on);
      };
    }

    // Security mode toggle
    const secBtn = $('tds-secBtn');
    if (secBtn) {
      secBtn.onclick = () => {
        const on = self.toggleSecurityMode();
        secBtn.classList.toggle('active', on);
        secBtn.setAttribute('aria-pressed', on);
        secBtn.dataset.mode = 'security';
        const banner = $('tds-secBanner');
        if (banner) banner.classList.toggle('visible', on);
        const svg = $('tds-diagram');
        if (svg) svg.closest('.tds-canvas').classList.toggle('tds-security-mode', on);
      };
    }

    // Layout edit mode toggle
    const layoutEditBtn = $('tds-layoutEditBtn');
    if (layoutEditBtn) {
      layoutEditBtn.onclick = () => self.toggleLayoutEditMode();
    }
    const copyPosBtn = $('tds-copyPosBtn');
    if (copyPosBtn) {
      copyPosBtn.onclick = () => self.copyPositions();
    }

    // Tuning toggle
    const tuningBtn = $('tds-tuningBtn');
    const tuningGroup = $('tds-tuningGroup');
    if (tuningBtn && tuningGroup) {
      tuningBtn.onclick = () => {
        const collapsed = tuningGroup.classList.toggle('collapsed');
        tuningBtn.textContent = collapsed ? 'Tuning ▸' : 'Tuning ▾';
      };
    }

    // Shortcuts modal
    const shortcutsBtn = $('tds-shortcutsBtn');
    const shortcutsBg = $('tds-shortcutsBg');
    const shortcutsClose = $('tds-shortcutsClose');
    const openShortcuts = () => { if (shortcutsBg) shortcutsBg.classList.add('visible'); };
    const closeShortcuts = () => { if (shortcutsBg) shortcutsBg.classList.remove('visible'); };
    if (shortcutsBtn) shortcutsBtn.onclick = openShortcuts;
    if (shortcutsClose) shortcutsClose.onclick = closeShortcuts;
    if (shortcutsBg) shortcutsBg.addEventListener('click', e => { if (e.target === shortcutsBg) closeShortcuts(); });
    self._openShortcuts = openShortcuts;
    self._closeShortcuts = closeShortcuts;

    // AI Assist button (#144)
    const aiAssistBtn = $('tds-aiAssistBtn');
    if (aiAssistBtn) {
      aiAssistBtn.onclick = () => self.showAIAssist();
    }

    // Theme toggle button
    const themeBtn = $('tds-themeBtn');
    if (themeBtn) themeBtn.onclick = () => self.setTheme(self._theme === 'dark' ? 'light' : 'dark');

    // Export button (#137)
    const exportBtn = $('tds-exportBtn');
    if (exportBtn) {
      exportBtn.onclick = () => self._showExportMenu(exportBtn);
    }

    if (this._glossary.length) {
      $('tds-glossBtn').onclick = () => self._openGlossary();
      $('tds-modalClose').onclick = () => self._closeGlossary();
      $('tds-modalBg').addEventListener('click', e => { if (e.target.id === 'tds-modalBg') self._closeGlossary(); });
    }

    // SVG interactive events: double-click on link → Link Mode
    const svg = $('tds-diagram');
    if (svg) {
      svg.addEventListener('dblclick', e => {
        const linkEl = e.target.closest('[data-tds-link]');
        if (linkEl) {
          self.setMode('link');
          const linkId = linkEl.getAttribute('data-tds-link');
          self._showPropertiesPanel(linkId, 'link');
          return;
        }
        const nodeEl = e.target.closest('[data-tds-node]');
        if (nodeEl) {
          const nodeId = nodeEl.getAttribute('data-tds-node');
          self._showPropertiesPanel(nodeId, 'node');
          return;
        }
      });

      // Click on anchors → show properties (with delete)
      // Click on nodes in security mode → blast radius
      svg.addEventListener('click', e => {
        const anchorEl = e.target.closest('[data-tds-anchor]');
        if (anchorEl) {
          const anchorId = anchorEl.getAttribute('data-tds-anchor');
          self._showPropertiesPanel(anchorId, 'anchor');
          return;
        }
        // Blast radius: click node in security mode to set/clear blast center
        if (self._securityMode) {
          const nodeEl = e.target.closest('[data-tds-node]');
          if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-tds-node');
            self.setBlastRadiusNode(self._blastRadiusNode === nodeId ? null : nodeId);
            return;
          }
        }
      });

      // Waypoint dragging: mousedown on anchor starts drag
      svg.addEventListener('mousedown', e => {
        const anchorEl = e.target.closest('[data-tds-anchor]');
        if (anchorEl) {
          const anchorId = anchorEl.getAttribute('data-tds-anchor');
          const anchorPos = self._anchors.get(anchorId);
          if (!anchorPos) return;
          e.preventDefault();
          self._draggingAnchor = anchorId;
          const pt = svg.createSVGPoint();
          pt.x = e.clientX; pt.y = e.clientY;
          const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
          self._dragOffset = { x: svgPt.x - anchorPos.x, y: svgPt.y - anchorPos.y };
          svg.style.cursor = 'grabbing';
          return;
        }

        // Node dragging (#148): mousedown on node starts drag-to-reposition
        if (self._layoutEditMode && self.interactiveMode === 'select' && !self._securityMode) {
          const nodeEl = e.target.closest('[data-tds-node]');
          if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-tds-node');
            const nodeCfg = self._nodes.get(nodeId);
            if (!nodeCfg) return;
            e.preventDefault();
            self._draggingNode = nodeId;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
            self._dragNodeOffset = { x: svgPt.x - nodeCfg.x, y: svgPt.y - nodeCfg.y };
            svg.style.cursor = 'grabbing';
            self._showCoordTooltip(nodeCfg.x, nodeCfg.y, nodeId, e.clientX, e.clientY);
          }
        }
      });

      const onMouseMove = e => {
        if (self._draggingAnchor) {
          e.preventDefault();
          const pt = svg.createSVGPoint();
          pt.x = e.clientX; pt.y = e.clientY;
          const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
          const anchorPos = self._anchors.get(self._draggingAnchor);
          if (anchorPos) {
            anchorPos.x = svgPt.x - self._dragOffset.x;
            anchorPos.y = svgPt.y - self._dragOffset.y;
            self.render();
          }
          return;
        }

        // Node drag move (#148)
        if (self._draggingNode) {
          e.preventDefault();
          const pt = svg.createSVGPoint();
          pt.x = e.clientX; pt.y = e.clientY;
          const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
          const nodeCfg = self._nodes.get(self._draggingNode);
          if (nodeCfg) {
            nodeCfg.x = Math.round(svgPt.x - self._dragNodeOffset.x);
            nodeCfg.y = Math.round(svgPt.y - self._dragNodeOffset.y);
            self._clearRouteCache();
            self.render();
            self._showCoordTooltip(nodeCfg.x, nodeCfg.y, self._draggingNode, e.clientX, e.clientY);
          }
        }
      };

      const onMouseUp = () => {
        if (self._draggingAnchor) {
          self._draggingAnchor = null;
          svg.style.cursor = '';
        }
        // Node drag end (#148): fire callback with final position
        if (self._draggingNode) {
          const nodeCfg = self._nodes.get(self._draggingNode);
          if (nodeCfg && self._onNodeReposition) {
            self._onNodeReposition({ id: self._draggingNode, x: nodeCfg.x, y: nodeCfg.y });
          }
          self._draggingNode = null;
          svg.style.cursor = '';
          self._hideCoordTooltip();
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Touch support for node dragging (#148)
      svg.addEventListener('touchstart', e => {
        if (!self._layoutEditMode || self.interactiveMode !== 'select' || self._securityMode) return;
        const touch = e.touches[0];
        const nodeEl = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-tds-node]');
        if (!nodeEl) return;
        const nodeId = nodeEl.getAttribute('data-tds-node');
        const nodeCfg = self._nodes.get(nodeId);
        if (!nodeCfg) return;
        // Long-press detection for mobile drag (prevents conflict with swipe navigation)
        self._touchDragTimer = setTimeout(() => {
          e.preventDefault();
          self._draggingNode = nodeId;
          const pt = svg.createSVGPoint();
          pt.x = touch.clientX; pt.y = touch.clientY;
          const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
          self._dragNodeOffset = { x: svgPt.x - nodeCfg.x, y: svgPt.y - nodeCfg.y };
          self._showCoordTooltip(nodeCfg.x, nodeCfg.y, nodeId, touch.clientX, touch.clientY);
        }, 300);
      }, { passive: false });

      svg.addEventListener('touchmove', e => {
        if (self._touchDragTimer) { clearTimeout(self._touchDragTimer); self._touchDragTimer = null; }
        if (!self._draggingNode) return;
        e.preventDefault();
        const touch = e.touches[0];
        const pt = svg.createSVGPoint();
        pt.x = touch.clientX; pt.y = touch.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
        const nodeCfg = self._nodes.get(self._draggingNode);
        if (nodeCfg) {
          nodeCfg.x = Math.round(svgPt.x - self._dragNodeOffset.x);
          nodeCfg.y = Math.round(svgPt.y - self._dragNodeOffset.y);
          self._clearRouteCache();
          self.render();
          self._showCoordTooltip(nodeCfg.x, nodeCfg.y, self._draggingNode, touch.clientX, touch.clientY);
        }
      }, { passive: false });

      svg.addEventListener('touchend', () => {
        if (self._touchDragTimer) { clearTimeout(self._touchDragTimer); self._touchDragTimer = null; }
        if (self._draggingNode) {
          const nodeCfg = self._nodes.get(self._draggingNode);
          if (nodeCfg && self._onNodeReposition) {
            self._onNodeReposition({ id: self._draggingNode, x: nodeCfg.x, y: nodeCfg.y });
          }
          self._draggingNode = null;
          self._hideCoordTooltip();
        }
      });
    }

    // Mode indicator toggle
    const modeInd = $('tds-mode-indicator');
    if (modeInd) {
      modeInd.onclick = () => {
        self.setMode(self.interactiveMode === 'link' ? 'select' : 'link');
      };
    }

    // Escape key exits link mode, hides properties
    document.addEventListener('keydown', e => {
      const t = (e.target?.tagName || '').toLowerCase();
      if (t === 'input' || t === 'select' || t === 'textarea') return;
      // Presentation mode keys take priority
      if (e.key === 'Escape' && self._presenting) { e.preventDefault(); self.exitPresentation(); return; }
      if ((e.key === 'f' || e.key === 'F') && self._presenting) { e.preventDefault(); self._togglePresentFullscreen(); return; }
      if (e.key === 'F5') { e.preventDefault(); self.present(); return; }
      // Arrow keys in Present mode advance/retreat steps without leaving Present mode.
      // Escape is the only exit — we stop the auto-advance timer, blur any
      // focused control that could steal the key event, and re-animate the
      // progress bar so the remaining dwell is reset for the new step.
      if (self._presenting && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        clearTimeout(self._presentTimer);
        clearInterval(self._presentProgressInterval);
        if (e.key === 'ArrowRight') self.next(); else self.prev();
        if (self._presentOpts && self._presentOpts.autoAdvance > 0) {
          self._startPresentAutoAdvance(self._presentOpts.autoAdvance);
        }
        return;
      }
      if (e.key === 'Escape') { self.setMode('select'); self._hidePropertiesPanel(); closeShortcuts(); return; }
      if (e.key === ' ') { e.preventDefault(); self.playing ? self.pause() : self.play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); self.playing = false; clearTimeout(self._timer); self.next(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); self.playing = false; clearTimeout(self._timer); if (document.activeElement && document.activeElement.disabled) document.activeElement.blur(); self.prev(); }
      else if (e.key === 'Home') { e.preventDefault(); self.playing = false; clearTimeout(self._timer); self.reset(); }
      else if (e.key === 'End')  { e.preventDefault(); self.playing = false; clearTimeout(self._timer); self.goTo(self._steps.length); }
      else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); self._openGlossary(); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); self._toggleNarrator(); }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); self.toggleNodeIds(); }
      else if (e.key === '?') { e.preventDefault(); openShortcuts(); }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); self.toggleLayoutEditMode(); }
    });

    // Swipe gestures for mobile (Fix #15)
    const canvas = document.querySelector('.tds-canvas');
    if (canvas) {
      let touchStartX = 0, touchStartY = 0;
      canvas.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      canvas.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0) { self.playing = false; clearTimeout(self._timer); self.next(); }
          else { self.playing = false; clearTimeout(self._timer); self.prev(); }
        }
      }, { passive: true });
    }
  }

  /* ── Playback ── */
  play() {
    this._trackAnalytics('play', { step: this.step });
    if (this.reducedMotion) {
      console.warn('Playback disabled: prefers-reduced-motion is active');
      return this;
    }
    if (this.mode === 'manual') {
      this.mode = 'auto';
      const sel = document.getElementById('tds-modeSel');
      if (sel) { sel.value = 'auto'; }
      const sr = document.getElementById('tds-speedRange');
      if (sr) sr.classList.remove('hidden');
    }
    if (this.step >= this._steps.length) this.step = 0;
    this.playing = true;
    this._updateUI();
    this._advance();
    return this;
  }

  pause() {
    this._trackAnalytics('pause', { step: this.step });
    this.playing = false;
    clearTimeout(this._timer);
    this._updateUI();
    return this;
  }

  /* ── Presentation Mode ── */

  /**
   * Enter full-screen presentation mode.
   * @param {object} opts
   * @param {number} opts.autoAdvance - ms between steps (0 = manual)
   * @param {boolean} opts.showNotes - show presenter notes panel
   * @returns {TopologyDesigner} this
   */
  present({ autoAdvance = 0, showNotes = false } = {}) {
    if (this._presenting) return this;
    this._presenting = true;
    this._presentOpts = { autoAdvance, showNotes };
    this._trackAnalytics('present', { autoAdvance, showNotes });

    // Add presenting class to root
    const root = document.querySelector('.tds-root');
    if (root) root.classList.add('tds-presenting');

    // Request fullscreen
    const container = document.querySelector('.tds-root') || document.documentElement;
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    }

    // Create step counter overlay
    this._presentCounter = document.createElement('div');
    this._presentCounter.className = 'tds-present-counter';
    this._presentCounter.id = 'tds-presentCounter';
    document.body.appendChild(this._presentCounter);

    // Create auto-advance progress bar
    if (autoAdvance > 0) {
      this._presentProgress = document.createElement('div');
      this._presentProgress.className = 'tds-present-progress';
      this._presentProgress.innerHTML = '<div class="tds-present-progress-fill" id="tds-presentProgressFill"></div>';
      document.body.appendChild(this._presentProgress);
    }

    // Create presenter notes panel
    if (showNotes) {
      this._presentNotes = document.createElement('div');
      this._presentNotes.className = 'tds-presenter-notes';
      this._presentNotes.id = 'tds-presenterNotes';
      document.body.appendChild(this._presentNotes);
    }

    // Start auto-advance if configured
    if (autoAdvance > 0) {
      this._startPresentAutoAdvance(autoAdvance);
    }

    // Listen for fullscreen exit
    this._fsChangeHandler = () => {
      if (!document.fullscreenElement && this._presenting) {
        this.exitPresentation();
      }
    };
    document.addEventListener('fullscreenchange', this._fsChangeHandler);

    this._updatePresentUI();
    return this;
  }

  /**
   * Exit presentation mode — restore all UI, exit fullscreen.
   * @returns {TopologyDesigner} this
   */
  exitPresentation() {
    if (!this._presenting) return this;
    this._presenting = false;
    this._trackAnalytics('exitPresentation', { step: this.step });

    // Remove presenting class
    const root = document.querySelector('.tds-root');
    if (root) root.classList.remove('tds-presenting');

    // Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // Clear auto-advance timer
    clearTimeout(this._presentTimer);
    clearInterval(this._presentProgressInterval);

    // Remove overlays
    if (this._presentCounter) { this._presentCounter.remove(); this._presentCounter = null; }
    if (this._presentProgress) { this._presentProgress.remove(); this._presentProgress = null; }
    if (this._presentNotes) { this._presentNotes.remove(); this._presentNotes = null; }

    // Remove fullscreen listener
    if (this._fsChangeHandler) {
      document.removeEventListener('fullscreenchange', this._fsChangeHandler);
      this._fsChangeHandler = null;
    }

    return this;
  }

  _updatePresentUI() {
    if (!this._presenting) return;

    // Update step counter
    const total = this._steps.length;
    if (this._presentCounter) {
      this._presentCounter.textContent = this.step > 0
        ? `${this.step} / ${total}`
        : `0 / ${total}`;
    }

    // Update presenter notes
    if (this._presentNotes) {
      const step = this.step > 0 && this.step <= this._steps.length
        ? this._steps[this.step - 1]
        : null;
      const notes = step && step.notes ? step.notes : '';
      this._presentNotes.innerHTML = notes
        ? `<div class="tds-presenter-notes-title">Presenter Notes</div><div>${notes}</div>`
        : `<div class="tds-presenter-notes-title">Presenter Notes</div><div style="color:rgba(255,255,255,0.3);font-style:italic">No notes for this step</div>`;
    }
  }

  _startPresentAutoAdvance(ms) {
    clearTimeout(this._presentTimer);
    clearInterval(this._presentProgressInterval);

    const advanceStep = () => {
      if (!this._presenting) return;
      if (this.step >= this._steps.length) {
        // Presentation complete
        clearInterval(this._presentProgressInterval);
        return;
      }
      this.step++;
      this.render();
      this._updatePresentUI();

      // Animate progress bar
      this._animatePresentProgress(ms);

      if (this.step < this._steps.length) {
        this._presentTimer = setTimeout(advanceStep, ms);
      }
    };

    // Animate first progress bar
    this._animatePresentProgress(ms);
    this._presentTimer = setTimeout(advanceStep, ms);
  }

  _animatePresentProgress(ms) {
    const fill = document.getElementById('tds-presentProgressFill');
    if (!fill) return;
    // Reset
    fill.style.transition = 'none';
    fill.style.width = '0%';
    // Force reflow
    fill.offsetWidth; // eslint-disable-line no-unused-expressions
    // Animate to 100%
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '100%';
  }

  _togglePresentFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      const container = document.querySelector('.tds-root') || document.documentElement;
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      }
    }
  }

  next() {
    this._trackAnalytics('next', { step: this.step });
    if (this.step < this._steps.length) { this.step++; this._trackStepView(this._steps[this.step - 1]?.id); this.render(); }
    return this;
  }

  prev() {
    this._trackAnalytics('prev', { step: this.step });
    if (this.step > 0) { this.step--; this._trackStepView(this._steps[this.step - 1]?.id); this.render(); }
    return this;
  }

  reset() {
    this._trackAnalytics('reset', { step: this.step });
    this.playing = false;
    clearTimeout(this._timer);
    this.step = 0;
    this.render();
    return this;
  }

  goTo(n) {
    this.step = Math.max(0, Math.min(this._steps.length, n));
    this.render();
    return this;
  }

  /** Toggle showing/hiding Node IDs on the diagram */
  toggleNodeIds(show) {
    this.showNodeIds = show !== undefined ? show : !this.showNodeIds;
    this.render();
    return this.showNodeIds;
  }

  /** Set the interactive editing mode */
  setMode(mode) {
    if (['select', 'link'].includes(mode)) {
      this.interactiveMode = mode;
      if (this._onModeChange) this._onModeChange(mode);
      this._updateModeUI();
    }
    return this;
  }

  /** Remove an anchor/waypoint by id */
  removeAnchor(id) {
    if (!this._anchors.has(id)) return false;

    // Use graph's removeAnchor which also removes dependent links
    let removedLinks;
    if (this._graph) {
      removedLinks = this._graph.removeAnchor(id);
    } else {
      this.__anchors.delete(id);
      removedLinks = [];
      for (const [linkId, linkCfg] of this.__links) {
        if (linkCfg.from === id || linkCfg.to === id) {
          this.__links.delete(linkId);
          removedLinks.push(linkId);
        }
      }
    }

    // Remove anchor and its dependent links from step phases
    const idsToRemove = new Set([id, ...removedLinks]);
    for (const step of this._steps) {
      if (!step.phases) continue;
      for (const phase of step.phases) {
        if (phase.show) {
          phase.show = phase.show.filter(elemId => !idsToRemove.has(elemId));
        }
      }
    }
    this._hidePropertiesPanel();
    this.render();
    return true;
  }

  /** Show a properties panel for the selected element */
  _showPropertiesPanel(elementId, elementType) {
    this._selectedElement = elementId;
    let panel = document.getElementById('tds-properties-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tds-properties-panel';
      panel.style.cssText = 'position:absolute;top:8px;right:8px;width:220px;background:rgba(34,37,46,.95);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;z-index:100;font-family:inherit;backdrop-filter:blur(16px);box-shadow:0 8px 32px rgba(0,0,0,.4)';
      const container = document.getElementById(this._containerId);
      if (container) container.style.position = 'relative';
      (container || document.body).appendChild(panel);
    }
    this._propertiesPanel = panel;

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">` +
      `<span style="font-size:9px;color:#7d8a92;font-weight:700;letter-spacing:1px;text-transform:uppercase">PROPERTIES</span>` +
      `<button id="tds-props-close" style="background:none;border:1px solid rgba(255,255,255,.08);border-radius:4px;color:#7d8a92;cursor:pointer;padding:2px 6px;font-size:10px">✕</button></div>`;
    html += `<div style="font-size:10px;color:#e6e8e9;margin-bottom:6px"><span style="color:#01a982;font-weight:600">${elementType}:</span> ${elementId}</div>`;

    if (elementType === 'anchor') {
      const pos = this._anchors.get(elementId);
      if (pos) {
        html += `<div style="font-size:9px;color:#7d8a92;margin-bottom:4px">Position: (${Math.round(pos.x)}, ${Math.round(pos.y)})</div>`;
        html += `<button id="tds-props-delete" style="margin-top:8px;width:100%;padding:6px;font-size:10px;font-weight:600;background:rgba(252,97,97,.1);border:1px solid rgba(252,97,97,.3);border-radius:6px;color:#fc6161;cursor:pointer;font-family:inherit">Delete Waypoint</button>`;
      }
    } else if (elementType === 'node') {
      const node = this._nodes.get(elementId);
      if (node) {
        html += `<div style="font-size:9px;color:#7d8a92;margin-bottom:2px">Type: ${node.type}</div>`;
        html += `<div style="font-size:9px;color:#7d8a92;margin-bottom:2px">Position: (${Math.round(node.x)}, ${Math.round(node.y)})</div>`;
        if (node.label) html += `<div style="font-size:9px;color:#7d8a92">Label: ${_esc(node.label)}</div>`;
      }
    } else if (elementType === 'link') {
      const link = this._links.get(elementId);
      if (link) {
        html += `<div style="font-size:9px;color:#7d8a92;margin-bottom:2px">Type: ${link.type}</div>`;
        html += `<div style="font-size:9px;color:#7d8a92;margin-bottom:6px;display:flex;align-items:center;gap:4px">` +
          `<span>From: <b style="color:#e6e8e9">${link.from}</b></span>` +
          `<button id="tds-props-swap" style="background:rgba(101,174,249,.12);border:1px solid rgba(101,174,249,.3);border-radius:4px;color:#65aef9;cursor:pointer;padding:2px 6px;font-size:9px;font-weight:700;font-family:inherit" title="Swap direction (reverse packet flow)">⇄</button>` +
          `<span>To: <b style="color:#e6e8e9">${link.to}</b></span></div>`;
        // Link label
        html += `<div style="margin-bottom:4px"><label style="font-size:8px;color:#7d8a92;letter-spacing:.5px;text-transform:uppercase">Label</label>` +
          `<input id="tds-props-label" type="text" value="${link.label || ''}" placeholder="e.g. IPsec Tunnel" style="width:100%;box-sizing:border-box;margin-top:2px;padding:4px 6px;font-size:10px;font-family:inherit;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e6e8e9;outline:none"/></div>`;
        // Endpoint labels (port labels)
        html += `<div style="display:flex;gap:6px;margin-bottom:4px">` +
          `<div style="flex:1"><label style="font-size:8px;color:#7d8a92;letter-spacing:.5px;text-transform:uppercase">From port</label>` +
          `<input id="tds-props-fromLabel" type="text" value="${link.fromLabel || ''}" placeholder="e.g. lan0" style="width:100%;box-sizing:border-box;margin-top:2px;padding:4px 6px;font-size:10px;font-family:inherit;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e6e8e9;outline:none"/></div>` +
          `<div style="flex:1"><label style="font-size:8px;color:#7d8a92;letter-spacing:.5px;text-transform:uppercase">To port</label>` +
          `<input id="tds-props-toLabel" type="text" value="${link.toLabel || ''}" placeholder="e.g. e0" style="width:100%;box-sizing:border-box;margin-top:2px;padding:4px 6px;font-size:10px;font-family:inherit;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e6e8e9;outline:none"/></div></div>`;
      }
    }

    panel.innerHTML = html;
    panel.style.display = 'block';

    // Bind close
    const closeBtn = document.getElementById('tds-props-close');
    if (closeBtn) closeBtn.onclick = () => this._hidePropertiesPanel();

    // Bind delete for anchors
    const delBtn = document.getElementById('tds-props-delete');
    if (delBtn) delBtn.onclick = () => this.removeAnchor(elementId);

    // Bind swap direction for links
    const swapBtn = document.getElementById('tds-props-swap');
    if (swapBtn && elementType === 'link') {
      swapBtn.onclick = () => {
        const link = this._links.get(elementId);
        if (link) {
          const tmp = link.from;
          link.from = link.to;
          link.to = tmp;
          // Also swap endpoint labels
          const tmpLabel = link.fromLabel;
          link.fromLabel = link.toLabel;
          link.toLabel = tmpLabel;
          this.render();
          this._showPropertiesPanel(elementId, 'link');
        }
      };
    }

    // Bind label inputs for links
    if (elementType === 'link') {
      const link = this._links.get(elementId);
      const labelInput = document.getElementById('tds-props-label');
      const fromLabelInput = document.getElementById('tds-props-fromLabel');
      const toLabelInput = document.getElementById('tds-props-toLabel');
      const updateLink = () => {
        if (!link) return;
        link.label = labelInput?.value || '';
        link.fromLabel = fromLabelInput?.value || '';
        link.toLabel = toLabelInput?.value || '';
        this.render();
      };
      if (labelInput) labelInput.addEventListener('input', updateLink);
      if (fromLabelInput) fromLabelInput.addEventListener('input', updateLink);
      if (toLabelInput) toLabelInput.addEventListener('input', updateLink);
    }
  }

  _hidePropertiesPanel() {
    this._selectedElement = null;
    const panel = document.getElementById('tds-properties-panel');
    if (panel) panel.style.display = 'none';
  }

  _updateModeUI() {
    const modeIndicator = document.getElementById('tds-mode-indicator');
    if (modeIndicator) {
      modeIndicator.textContent = this.interactiveMode === 'link' ? 'LINK MODE' : 'SELECT';
      modeIndicator.classList.toggle('link-mode', this.interactiveMode === 'link');
    }
  }

  _showCompletion() {
    const lbl = document.getElementById('tds-stepLabel');
    if (lbl) {
      lbl.innerHTML = `<div class="tds-completion"><span>✓ Presentation complete</span></div>`;
    }
    const pb = document.getElementById('tds-playBtn');
    if (pb) {
      pb.textContent = '⟲ Replay';
      pb.className = 'tds-btn play';
    }
  }

  _advance() {
    if (!this.playing) { this._updateUI(); return; }
    if (this.step >= this._steps.length) { this.playing = false; this._updateUI(); this._showCompletion(); return; }
    const nextStep = this.step + 1;
    if (this.mode === 'presenter' && this._isActBound(nextStep)) {
      this.step = nextStep; this.render();
      this.playing = false; this._updateUI(); return;
    }
    this.step++;
    this.render();
    if (this.mode === 'auto' || this.mode === 'presenter') {
      this._timer = setTimeout(() => this._advance(), this.speedMs);
    } else {
      this.playing = false; this._updateUI();
    }
  }

  /* ── Render orchestrator ── */
  render() {
    if (!this._mounted) return;

    // Fire plugin beforeRender hooks
    for (const hook of this._pluginHooks.beforeRender) {
      hook({ step: this.step, designer: this });
    }

    const scrollY = window.scrollY, scrollX = window.scrollX;
    const prevStep = this._lastRenderedStep ?? -1;

    // Clear route cache on step change
    if (prevStep !== this.step) {
      this._clearRouteCache();

      // Apply position keyframes for choreography smoothing
      for (const [id, cfg] of this._nodes) {
        if (cfg._positions && cfg._positions[this.step]) {
          const target = cfg._positions[this.step];
          if (prevStep >= 0 && !this.reducedMotion && (cfg.x !== target.x || cfg.y !== target.y)) {
            // Trigger smooth interpolation
            const fromX = cfg.x, fromY = cfg.y;
            cfg.x = target.x; cfg.y = target.y;
            this._interpolatePositionInline(id, fromX, fromY, target.x, target.y);
          } else {
            cfg.x = target.x; cfg.y = target.y;
          }
        }
      }
    }

    // Try incremental render for small changes; fall back to full re-render
    let usedIncremental = false;
    if (prevStep >= 0 && Math.abs(this.step - prevStep) === 1) {
      usedIncremental = this._incrementalRender(prevStep);
    }

    if (!usedIncremental) {
      document.getElementById('tds-diagram').innerHTML = this._renderSVG();
    }

    this._lastRenderedStep = this.step;

    this._updateNarrator();
    this._updateUI();
    this._updateURL();
    window.scrollTo(scrollX, scrollY);

    // Fire plugin afterRender hooks
    for (const hook of this._pluginHooks.afterRender) {
      hook({ step: this.step, designer: this });
    }

    // Fire onStepChange hooks
    if (prevStep !== this.step) {
      for (const hook of this._pluginHooks.onStepChange) {
        hook({ prevStep, step: this.step, designer: this });
      }
    }
    return this;
  }

  /**
   * Inline position interpolation using CSS transitions on SVG transform.
   * Lighter-weight than full _interpolateStep for single-step changes.
   */
  _interpolatePositionInline(nodeId, fromX, fromY, toX, toY) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-tds-node="${nodeId}"]`);
      if (!el) return;
      const dx = toX - fromX, dy = toY - fromY;
      el.style.transition = `transform ${this._interpolationDuration}ms cubic-bezier(.4,0,.2,1)`;
      el.style.transform = `translate(${-dx}px, ${-dy}px)`;
      requestAnimationFrame(() => {
        el.style.transform = 'translate(0,0)';
      });
    });
  }

  /* ══════════════════════════════════════════
     NARRATOR
     ══════════════════════════════════════════ */

  _toggleNarrator() {
    this.narCollapsed = !this.narCollapsed;
    const nar = document.getElementById('tds-narrator');
    if (nar) nar.classList.toggle('collapsed', this.narCollapsed);
    const btn = document.querySelector('.tds-nar-toggle');
    if (btn) btn.innerHTML = this.narCollapsed ? '◂' : '▸';
  }

  _updateNarrator() {
    const nar = document.getElementById('tds-narrator');
    if (!nar) return;
    const toggleBtn = `<button class="tds-nar-toggle" onclick="document.querySelector('.tds-nar-toggle')?.click?.()" title="Toggle narrator (N)">${this.narCollapsed ? '◂' : '▸'}</button>`;
    const collapsedLabel = `<div class="tds-collapsed-label" onclick="document.querySelector('.tds-nar-toggle')?.click?.()">Narrator</div>`;

    if (this.step === 0) {
      const modeDesc = this.mode === 'auto' ? 'Steps advance automatically at the set speed.'
        : this.mode === 'presenter' ? 'Keyboard-driven, optimized for live demos.'
        : 'Click Next/Prev or use arrow keys to advance one step at a time.';
      nar.innerHTML = `<div class="tds-nar-head"><div class="tds-title"><span class="tds-dots"><span class="tds-dot r"></span><span class="tds-dot y"></span><span class="tds-dot g"></span></span><span class="tds-title-text">NARRATOR</span></div>${toggleBtn}<span class="tds-badge" title="${modeDesc}">Mode: ${this.mode.toUpperCase()}</span></div>${collapsedLabel}<div class="tds-nar-body"><div class="tds-line">Use <b>Play</b> or step through the story. Click sidebar steps to jump.</div><div class="tds-meta"><div class="tds-k">${this.mode.charAt(0).toUpperCase() + this.mode.slice(1)} mode</div><div class="tds-v">${modeDesc}</div><div class="tds-k">Tip</div><div class="tds-v">Press <span class="tds-kbd">Space</span> Play/Pause, <span class="tds-kbd">←</span>/<span class="tds-kbd">→</span> step.</div></div></div>`;
      // Re-bind toggle
      nar.querySelector('.tds-nar-toggle').onclick = () => this._toggleNarrator();
      return;
    }

    const s = this._steps[this.step - 1];
    const act = this._curAct();

    // Build diff bullets from phases
    const diffs = s.phases ? s.phases.map(p => p.diff).filter(Boolean) : [];

    // Act intro card if we're at the first step of an act
    const isActStart = act && (this.step - 1) === act.start;
    const actIntro = isActStart && act.intro
      ? `<div class="tds-act-intro"><div class="tds-act-intro-title" style="color:${act.color}">${_esc(act.label)} — INTRO</div>${act.intro.map(l => `<div class="tds-act-intro-line">${_esc(l)}</div>`).join('')}</div>`
      : '';

    nar.innerHTML = `<div class="tds-nar-head"><div class="tds-title"><span class="tds-dots"><span class="tds-dot r"></span><span class="tds-dot y"></span><span class="tds-dot g"></span></span><span class="tds-title-text">NARRATOR</span></div>${toggleBtn}<span class="tds-badge">Step ${this.step}/${this._steps.length}</span></div>${collapsedLabel}` +
      `<div class="tds-nar-body"><div class="tds-line"><span style="color:${act?.color || '#b1b9be'};font-weight:700">${_esc(act?.label || '')}</span> · <span style="color:#e6e8e9;font-weight:700">${_esc(s.name)}</span></div>` +
      `<div class="tds-meta"><div class="tds-k">Goal</div><div class="tds-v">${_esc(s.goal || '')}</div>` +
      (s.narration ? `<div class="tds-k">Narration</div><div class="tds-v" style="color:#deb146;font-style:italic">${_esc(s.narration)}</div>` : '') +
      `<div class="tds-k">Changed</div><div class="tds-v"><div class="tds-bullets">${diffs.map(d => `<div>• ${_esc(d)}</div>`).join('')}</div></div></div>${actIntro}</div>`;

    nar.classList.toggle('collapsed', this.narCollapsed);
    nar.querySelector('.tds-nar-toggle').onclick = () => this._toggleNarrator();

    // Screen reader announcement
    const liveRegion = document.getElementById('tds-live-region');
    if (liveRegion) {
      liveRegion.textContent = `Step ${this.step} of ${this._steps.length}: ${s.name}. ${s.goal || ''}`;
    }
  }

  /* ══════════════════════════════════════════
     UI UPDATES
     ══════════════════════════════════════════ */

  _updateUI() {
    // Pips
    document.querySelectorAll('.tds-pip').forEach((p, i) => p.classList.toggle('active', this.step >= i + 1));

    // Step counter (toolbar + controls)
    const total = this._steps.length;
    const counterHTML = this.step > 0
      ? `<span class="tds-cur">${this.step}</span> / ${total}`
      : `0 / ${total}`;
    const counter = document.getElementById('tds-stepCounter');
    if (counter) counter.innerHTML = counterHTML;
    const counterCtrl = document.getElementById('tds-stepCounterCtrl');
    if (counterCtrl) counterCtrl.innerHTML = counterHTML;

    // Progress bar
    const progressFill = document.getElementById('tds-progressFill');
    if (progressFill) {
      const pct = total > 0 ? (this.step / total) * 100 : 0;
      progressFill.style.width = pct + '%';
    }

    // Step label in toolbar
    const lbl = document.getElementById('tds-stepLabel');
    if (lbl) {
      if (this.step > 0 && this.step <= this._steps.length) {
        const act = this._curAct();
        lbl.innerHTML = `<span><span style="color:var(--tds-green);font-weight:700">Step ${this.step}/${this._steps.length}</span><span style="margin:0 6px;color:#535c66">│</span>${act ? `<span style="color:${act.color};font-size:8px">${_esc(act.label.split('·')[0].trim())} ·</span> ` : ''}${_esc(this._steps[this.step-1].name)}</span>`;
      } else {
        lbl.innerHTML = `<span style="font-size:10px;color:var(--tds-muted2)">Press Play or step through →</span>`;
      }
    }

    // Sidebar step rows
    document.querySelectorAll('.tds-step-row').forEach((r, i) => {
      r.classList.toggle('active', this.step >= i + 1);
      r.classList.toggle('current', this.step === i + 1);
    });

    // Button states
    const prevBtn = document.getElementById('tds-prevBtn');
    const nextBtn = document.getElementById('tds-nextBtn');
    if (prevBtn) prevBtn.disabled = this.step === 0;
    if (nextBtn) nextBtn.disabled = this.step >= this._steps.length;

    // Speed range visibility
    const sr = document.getElementById('tds-speedRange');
    if (sr) sr.classList.toggle('hidden', this.mode === 'manual');

    // Mode select sync
    const ms = document.getElementById('tds-modeSel');
    if (ms) { ms.value = this.mode; if (this.reducedMotion) { this.mode = 'manual'; ms.value = 'manual'; } }

    // Play/pause button
    const pb = document.getElementById('tds-playBtn');
    if (pb) {
      if (this.playing) {
        pb.textContent = '⏸ Pause'; pb.className = 'tds-btn pause';
      } else {
        pb.textContent = '▶ Play'; pb.className = 'tds-btn play';
      }
      if (this.reducedMotion) { pb.disabled = true; pb.title = 'Disabled: prefers-reduced-motion'; }
    }

    // Speed label
    const sl = document.getElementById('tds-speedLbl');
    if (sl) sl.textContent = (this.speedMs / 1000).toFixed(1) + 's';

    // Scroll current step into view
    const cur = document.querySelector('.tds-step-row.current');
    if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // Presentation mode overlay updates
    this._updatePresentUI();
  }

  /* ══════════════════════════════════════════
     DRAG-TO-REPOSITION — Coordinate Tooltip (#148)
     ══════════════════════════════════════════ */

  _showCoordTooltip(x, y, nodeId, clientX, clientY) {
    if (!this._coordTooltip) {
      this._coordTooltip = document.createElement('div');
      this._coordTooltip.className = 'tds-coord-tooltip';
      document.body.appendChild(this._coordTooltip);
    }
    this._coordTooltip.innerHTML = `<span class="tds-coord-id">${_esc(nodeId)}</span> <span class="tds-coord-val">x:${x} y:${y}</span>`;
    this._coordTooltip.style.left = (clientX + 16) + 'px';
    this._coordTooltip.style.top = (clientY - 12) + 'px';
    this._coordTooltip.style.display = 'block';
  }

  _hideCoordTooltip() {
    if (this._coordTooltip) this._coordTooltip.style.display = 'none';
  }

  /**
   * Enter layout edit mode: save current positions, enable node dragging,
   * show the Copy Positions button.
   */
  enterLayoutEditMode() {
    if (this._layoutEditMode) return;
    this._layoutEditMode = true;
    // Snapshot current positions for restore on exit
    this._savedPositions = new Map();
    for (const [id, cfg] of this._nodes) {
      this._savedPositions.set(id, { x: cfg.x, y: cfg.y });
    }
    // Update toolbar button state
    const btn = document.getElementById('tds-layoutEditBtn');
    if (btn) { btn.setAttribute('aria-pressed', 'true'); btn.classList.add('active'); }
    const copyBtn = document.getElementById('tds-copyPosBtn');
    if (copyBtn) copyBtn.style.display = '';
    // Add visual indicator on canvas
    const svg = document.getElementById('tds-diagram');
    if (svg) svg.style.outline = '2px dashed var(--tds-accent, #01a982)';
  }

  /**
   * Exit layout edit mode: restore original positions (non-destructive),
   * hide the Copy Positions button, re-render.
   */
  exitLayoutEditMode() {
    if (!this._layoutEditMode) return;
    this._layoutEditMode = false;
    // Restore saved positions
    if (this._savedPositions) {
      for (const [id, pos] of this._savedPositions) {
        const cfg = this._nodes.get(id);
        if (cfg) { cfg.x = pos.x; cfg.y = pos.y; }
      }
      this._savedPositions = null;
    }
    // Update toolbar
    const btn = document.getElementById('tds-layoutEditBtn');
    if (btn) { btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('active'); }
    const copyBtn = document.getElementById('tds-copyPosBtn');
    if (copyBtn) copyBtn.style.display = 'none';
    const svg = document.getElementById('tds-diagram');
    if (svg) svg.style.outline = '';
    this._hideCoordTooltip();
    if (this._mounted) this.render();
  }

  /**
   * Toggle layout edit mode on/off.
   * @returns {boolean} new state
   */
  toggleLayoutEditMode() {
    if (this._layoutEditMode) {
      this.exitLayoutEditMode();
    } else {
      this.enterLayoutEditMode();
    }
    return this._layoutEditMode;
  }

  /**
   * Get a code snippet for current node positions — useful for readback after dragging.
   * Returns a JS string that recreates current positions via the node() API.
   * @returns {string}
   */
  getPositionSnippet() {
    const lines = [];
    for (const [id, cfg] of this._nodes) {
      lines.push(`td.node('${id}', { ...cfg, x: ${cfg.x}, y: ${cfg.y} });`);
    }
    return lines.join('\n');
  }

  /**
   * Copy all current node positions to clipboard as a JSON map.
   * @returns {Promise<object>} positions map { nodeId: {x, y} }
   */
  async copyPositions() {
    const positions = {};
    for (const [id, cfg] of this._nodes) {
      positions[id] = { x: cfg.x, y: cfg.y };
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(positions, null, 2));
    } catch (_) { /* clipboard not available */ }
    return positions;
  }

  /* ══════════════════════════════════════════
     STEP THUMBNAIL PREVIEWS (#141)
     ══════════════════════════════════════════ */

  /**
   * Render a lightweight SVG thumbnail for a given step number.
   * Returns an SVG string scaled to fit the given dimensions.
   * @param {number} stepNum - 1-based step number
   * @param {number} [width=160] - thumbnail width
   * @param {number} [height=90] - thumbnail height
   * @returns {string} SVG markup string
   */
  _renderThumbnail(stepNum, width = 160, height = 90) {
    if (stepNum < 1 || stepNum > this._steps.length) return '';
    const savedStep = this.step;
    this.step = stepNum;

    // Collect visible elements for this step
    const visibleNodes = new Set();
    const visibleLinks = new Set();
    const stepCfg = this._steps[stepNum - 1];

    // Walk all phases up to this step to find visible elements
    for (let s = 0; s < stepNum; s++) {
      const st = this._steps[s];
      if (st.phases) {
        st.phases.forEach(p => {
          if (p.show) p.show.forEach(id => {
            if (this._nodes.has(id)) visibleNodes.add(id);
            else if (this._links.has(id)) visibleLinks.add(id);
            else if (this._anchors.has(id)) { /* anchors are invisible */ }
          });
        });
      }
    }

    // Build mini SVG with simplified shapes
    const vb = this.viewBox.split(' ').map(Number);
    const vbW = vb[2] || 1050, vbH = vb[3] || 700;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${vbW} ${vbH}" style="background:#1d1f27;border-radius:4px">`;

    // Draw links as simple lines
    for (const linkId of visibleLinks) {
      const lk = this._links.get(linkId);
      if (!lk) continue;
      const fromNode = this._nodes.get(lk.from) || this._anchors.get(lk.from);
      const toNode = this._nodes.get(lk.to) || this._anchors.get(lk.to);
      if (!fromNode || !toNode) continue;
      const color = lk.color || '#535c66';
      svg += `<line x1="${fromNode.x}" y1="${fromNode.y}" x2="${toNode.x}" y2="${toNode.y}" stroke="${color}" stroke-width="2" opacity="0.6"/>`;
    }

    // Draw nodes as circles
    const focusSet = stepCfg.focus ? new Set(stepCfg.focus) : null;
    for (const nodeId of visibleNodes) {
      const nd = this._nodes.get(nodeId);
      if (!nd) continue;
      const isFocused = !focusSet || focusSet.has(nodeId);
      const color = nd.color || '#01a982';
      const opacity = isFocused ? 1 : 0.3;
      svg += `<circle cx="${nd.x}" cy="${nd.y}" r="12" fill="${color}" opacity="${opacity}"/>`;
    }

    svg += '</svg>';
    this.step = savedStep;
    return svg;
  }

  /* ══════════════════════════════════════════
     SIDEBAR
     ══════════════════════════════════════════ */

  _buildSidebar() {
    const el = document.getElementById('tds-sidebar');
    if (!el) return;
    el.innerHTML = '';
    const self = this;

    this._acts.forEach(act => {
      const c = document.createElement('div');
      c.className = 'tds-act';
      c.dataset.actId = act.id;

      const h = document.createElement('div');
      h.className = 'tds-act-hdr';
      h.innerHTML = `<div class="tds-left"><span style="color:${act.color}">${_esc(act.label)}</span></div><span class="tds-act-chevron">▾</span>`;
      h.onclick = () => {
        this._collapsedActs.set(act.id, !this._collapsedActs.get(act.id));
        this._buildSidebar();
        this._updateUI();
      };

      const b = document.createElement('div');
      b.className = 'tds-act-body';

      for (let i = act.start; i < act.start + act.count; i++) {
        const r = document.createElement('div');
        r.className = 'tds-step-row';
        r.setAttribute('tabindex', '0');
        r.setAttribute('role', 'button');
        r.setAttribute('aria-label', `Step ${i+1}: ${_esc(this._steps[i].name)}`);
        r.innerHTML = `<div class="tds-step-num">${i+1}</div><div class="tds-step-thumb">${this._renderThumbnail(i + 1, 80, 50)}</div><span>${_esc(this._steps[i].name)}</span><div class="tds-step-state"></div>`;
        r.onclick = () => { self.playing = false; clearTimeout(self._timer); self.goTo(i + 1); };
        r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } };

        // Step thumbnail preview on hover (#141)
        const stepIdx = i;
        r.addEventListener('mouseenter', function(e) {
          let tip = document.getElementById('tds-thumb-preview');
          if (!tip) {
            tip = document.createElement('div');
            tip.id = 'tds-thumb-preview';
            tip.className = 'tds-thumb-preview';
            document.body.appendChild(tip);
          }
          tip.innerHTML = self._renderThumbnail(stepIdx + 1, 200, 112);
          const rect = r.getBoundingClientRect();
          tip.style.left = (rect.right + 8) + 'px';
          tip.style.top = (rect.top - 10) + 'px';
          tip.style.display = 'block';
        });
        r.addEventListener('mouseleave', () => {
          const tip = document.getElementById('tds-thumb-preview');
          if (tip) tip.style.display = 'none';
        });

        b.appendChild(r);
      }

      if (this._collapsedActs.get(act.id)) c.classList.add('collapsed');
      c.appendChild(h);
      c.appendChild(b);
      el.appendChild(c);
    });
  }

  _buildPips() {
    const el = document.getElementById('tds-progress');
    if (!el) return;
    el.innerHTML = '';
    const self = this;
    this._steps.forEach((s, i) => {
      const p = document.createElement('div');
      p.className = 'tds-pip';
      p.title = s.name;
      p.onclick = () => { self.playing = false; clearTimeout(self._timer); self.goTo(i + 1); };
      el.appendChild(p);
    });
  }

  /* ══════════════════════════════════════════
     URL STATE & GLOSSARY
     ══════════════════════════════════════════ */

  _loadURL() {
    const sp = new URLSearchParams(location.search);
    const s = parseInt(sp.get('step') || '0', 10);
    const m = sp.get('mode');
    if (!isNaN(s) && isFinite(s)) this.step = Math.max(0, Math.min(this._steps.length, s));
    if (m && ['manual', 'auto', 'presenter'].includes(m)) this.mode = m;
    if (this.reducedMotion) this.mode = 'manual';
  }

  _updateURL() {
    const sp = new URLSearchParams(location.search);
    sp.set('step', String(this.step));
    sp.set('mode', this.mode);
    history.replaceState({}, '', `${location.pathname}?${sp.toString()}`);
  }

  _openGlossary() {
    const body = document.getElementById('tds-glossaryBody');
    if (body) body.innerHTML = this._glossary.map(x => `<div class="tds-term"><div class="tds-t">${_esc(x.t)}</div><div class="tds-d">${_esc(x.d)}</div></div>`).join('');
    const bg = document.getElementById('tds-modalBg');
    if (bg) bg.style.display = 'flex';
  }

  _closeGlossary() {
    const bg = document.getElementById('tds-modalBg');
    if (bg) bg.style.display = 'none';
  }

  /* ══════════════════════════════════════════
     AUTO-LAYOUT INTEGRATION
     Delegates to LayoutEngine if available
     ══════════════════════════════════════════ */

  /**
   * Apply an auto-layout algorithm to reposition all nodes.
   * Requires modules/layout-engine.js to be loaded.
   *
   * @param {string} algorithm - 'forceDirected'|'hierarchical'|'circular'|'grid'
   * @param {object} options   - algorithm-specific options
   * @param {boolean} animate  - smooth transition (default true)
   * @returns {TopologyDesigner} this (for chaining)
   */
  autoLayout(algorithm = 'forceDirected', options = {}, animate = true) {
    if (typeof LayoutEngine === 'undefined') {
      console.warn('TopologyDesigner: LayoutEngine not loaded. Include modules/layout-engine.js');
      return this;
    }

    const vb = this.viewBox.split(' ').map(Number);
    const defaults = { width: vb[2] || 1050, height: vb[3] || 700 };
    const opts = { ...defaults, ...options };

    const layoutFn = LayoutEngine[algorithm];
    if (!layoutFn) {
      console.warn(`TopologyDesigner: unknown layout algorithm "${algorithm}"`);
      return this;
    }

    let positions = layoutFn(this._nodes, this._links, opts);

    // Auto-remove overlaps unless explicitly disabled (#146)
    if (options.removeOverlaps !== false && typeof LayoutEngine.removeOverlaps === 'function') {
      positions = LayoutEngine.removeOverlaps(positions, opts);
    }

    LayoutEngine.apply(this, positions, animate);
    return this;
  }

  /**
   * Import a topology from text (Mermaid-inspired diagram-as-code).
   * Requires modules/template-parser.js to be loaded.
   *
   * @param {string} text - diagram-as-code text
   * @param {object} options - { layout, clearFirst }
   * @returns {TopologyDesigner} this (for chaining)
   */
  importFromText(text, options = {}) {
    if (typeof TemplateParser === 'undefined') {
      console.warn('TopologyDesigner: TemplateParser not loaded. Include modules/template-parser.js');
      return this;
    }

    const parsed = TemplateParser.fromText(text);
    TemplateParser.applyToDesigner(this, parsed, {
      layout: options.layout || 'hierarchical',
      clearFirst: options.clearFirst !== false,
      ...options,
    });

    this._buildIndex();
    if (this._mounted) this.render();
    return this;
  }

  /**
   * Load a built-in template.
   * Requires modules/template-parser.js and modules/layout-engine.js.
   *
   * @param {string} templateId - template identifier (e.g. '3-tier', 'mesh')
   * @param {object} options - template-specific options
   * @returns {TopologyDesigner} this (for chaining)
   */
  loadTemplate(templateId, options = {}) {
    if (typeof TemplateParser === 'undefined') {
      console.warn('TopologyDesigner: TemplateParser not loaded. Include modules/template-parser.js');
      return this;
    }

    const template = TemplateParser.TEMPLATES[templateId];
    if (!template) {
      console.warn(`TopologyDesigner: unknown template "${templateId}"`);
      return this;
    }

    const parsed = template.generate(options);
    TemplateParser.applyToDesigner(this, parsed, {
      layout: 'hierarchical',
      clearFirst: true,
      ...options,
    });

    this._buildIndex();
    if (this._mounted) this.render();
    return this;
  }

  /**
   * Apply a theme preset or custom theme.
   * Requires modules/theme-engine.js to be loaded.
   *
   * @param {string|object} theme - preset name or theme object
   * @returns {TopologyDesigner} this (for chaining)
   */
  applyTheme(theme) {
    if (typeof ThemeEngine === 'undefined') {
      console.warn('TopologyDesigner: ThemeEngine not loaded. Include modules/theme-engine.js');
      return this;
    }

    if (typeof theme === 'string') {
      const preset = ThemeEngine.PRESETS[theme];
      if (!preset) {
        console.warn(`TopologyDesigner: unknown theme "${theme}"`);
        return this;
      }
      ThemeEngine.apply(preset);
    } else {
      ThemeEngine.apply(theme);
    }

    if (this._mounted) this.render();
    return this;
  }

  /* ══════════════════════════════════════════
     EXPORT (#137) — PNG / SVG / PDF from viewer
     ══════════════════════════════════════════ */

  /** Show a dropdown export menu next to the given button */
  _showExportMenu(btn) {
    // Remove any existing menu
    const existing = document.getElementById('tds-export-menu');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'tds-export-menu';
    menu.style.cssText = 'position:absolute;right:0;top:100%;background:var(--tds-bg,#22252e);border:1px solid var(--tds-border,#3e4550);border-radius:8px;padding:4px;z-index:100;min-width:140px;box-shadow:0 8px 24px rgba(0,0,0,.5);font-family:inherit';
    menu.innerHTML = [
      { label: 'Export PNG', fn: 'exportPNG' },
      { label: 'Export SVG', fn: 'exportSVG' },
      { label: 'Export PDF', fn: 'exportPDF' },
      { label: 'Export Standalone HTML', fn: 'exportStandaloneHTML' },
      { label: 'Copy Embed Code', fn: 'copyEmbedCode' },
      { label: 'Analytics', fn: 'showAnalyticsDashboard' },
    ].map(item => `<div style="padding:5px 10px;font-size:10px;color:#e6e8e9;cursor:pointer;border-radius:4px;transition:background .12s" onmouseover="this.style.background='rgba(1,169,130,.1)'" onmouseout="this.style.background=''" onclick="document.getElementById('tds-export-menu').remove();this.closest('[id]')._tdsDesigner.${item.fn}()">${item.label}</div>`).join('');
    btn.style.position = 'relative';
    btn.style.zIndex = '9999';
    btn.appendChild(menu);
    btn._tdsDesigner = this;
    setTimeout(() => document.addEventListener('click', function _close(e) {
      if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', _close); }
    }), 10);
  }

  /** Build a sanitised export filename including step name when active */
  _exportFilename(ext) {
    let name = this.title.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (this.step > 0 && this._steps[this.step - 1]) {
      const stepName = this._steps[this.step - 1].name || '';
      name += `_Step_${this.step}_${stepName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }
    return `${name}.${ext}`;
  }

  /** Export the current canvas state as PNG */
  async exportPNG() {
    const svg = document.getElementById('tds-diagram');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const vb = this.viewBox.split(' ').map(Number);
    const w = 2400, h = Math.round(2400 * (vb[3] || 700) / (vb[2] || 1050));
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${this.viewBox}"><style>text{font-family:'JetBrains Mono','Courier New',monospace}</style><rect width="${vb[2]||1050}" height="${vb[3]||700}" fill="#1d1f27"/>${svg.innerHTML}</svg>`;
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
    ctx.fillStyle = '#1d1f27'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = this._exportFilename('png');
      a.click(); URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  /** Export the current canvas state as SVG */
  exportSVG() {
    const svg = document.getElementById('tds-diagram');
    if (!svg) return;
    const vb = this.viewBox.split(' ').map(Number);
    const w = vb[2] || 1050, h = vb[3] || 700;
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${this.viewBox}"><style>text{font-family:'JetBrains Mono','Courier New',monospace}</style><rect width="${w}" height="${h}" fill="#1d1f27"/>${svg.innerHTML}</svg>`;
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this._exportFilename('svg');
    a.click(); URL.revokeObjectURL(a.href);
  }

  /** Export the current view as PDF via the browser's print dialog */
  exportPDF() {
    const svg = document.getElementById('tds-diagram');
    if (!svg) return;
    const vb = this.viewBox.split(' ').map(Number);
    const w = vb[2] || 1050, h = vb[3] || 700;
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${this.viewBox}"><style>text{font-family:'JetBrains Mono','Courier New',monospace}</style><rect width="${w}" height="${h}" fill="#1d1f27"/>${svg.innerHTML}</svg>`;
    const filename = this._exportFilename('pdf');
    let win = window.open('', '_blank');
    if (!win) {
      // Fallback: use a hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;width:0;height:0;border:none';
      document.body.appendChild(iframe);
      win = iframe.contentWindow;
      if (!win) { alert('Pop-up blocked — please allow pop-ups for PDF export.'); return; }
      setTimeout(() => iframe.remove(), 10000);
    }
    win.document.write(`<!DOCTYPE html><html><head><title>${filename}</title><style>
      @page { size: landscape; margin: 0; }
      @media print { body { margin: 0; } }
      html, body { margin: 0; padding: 0; background: #1d1f27; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
      svg { max-width: 100vw; max-height: 100vh; }
    </style></head><body>${svgStr}</body></html>`);
    win.document.close();
    // Give the browser a tick to render, then trigger print
    setTimeout(() => { win.print(); }, 400);
  }

  /**
   * Serialize current topology to a portable JSON object.
   * Useful for save/load, import/export.
   *
   * @returns {object} Full topology state
   */
  toJSON() {
    return {
      title: this.title,
      subtitle: this.subtitle,
      viewBox: this.viewBox,
      phaseMs: this.phaseMs,
      drawDuration: this.drawDuration,
      fadeDuration: this.fadeDuration,
      nodes: Object.fromEntries(Array.from(this._nodes.entries()).map(([id, cfg]) => { const { id: _id, ...rest } = cfg; return [id, rest]; })),
      anchors: Object.fromEntries(this._anchors),
      links: Object.fromEntries(Array.from(this._links.entries()).map(([id, cfg]) => { const { id: _id, ...rest } = cfg; return [id, rest]; })),
      acts: this._acts.map(a => ({ id: a.id, label: a.label, color: a.color, intro: a.intro })),
      steps: this._steps.map(s => ({
        id: s.id, act: s.act, name: s.name, goal: s.goal,
        focus: s.focus,
        notes: s.notes || undefined,
        layerVisibility: s.layerVisibility,
        phases: s.phases ? s.phases.map(p => {
          const serialized = {};
          for (const [k, v] of Object.entries(p)) {
            if (typeof v !== 'function') serialized[k] = v;
          }
          return serialized;
        }) : [],
      })),
      glossary: this._glossary,
      layers: this._layers,
      flowPaths: Array.from(this._flowPaths.entries()),
      policyMarkers: Array.from(this._policyMarkers.entries()),
      zones: Array.from(this._zones.entries()),
      persistentElements: this._persistentElements || [],
    };
  }

  /**
   * Load topology from a JSON object (as produced by toJSON).
   *
   * @param {object} data
   * @returns {TopologyDesigner} this (for chaining)
   */
  fromJSON(data) {
    if (this._graph) {
      this._graph.clear();
    } else {
      this.__nodes.clear();
      this.__links.clear();
      this.__anchors.clear();
    }
    this._acts = [];
    this._steps = [];
    this._zones.clear();

    if (data.title) this.title = data.title;
    if (data.subtitle) this.subtitle = data.subtitle;
    if (data.viewBox) this.viewBox = data.viewBox;
    if (data.phaseMs) this.phaseMs = data.phaseMs;
    if (data.drawDuration) this.drawDuration = data.drawDuration;
    if (data.fadeDuration) this.fadeDuration = data.fadeDuration;

    if (data.nodes) {
      Object.entries(data.nodes).forEach(([id, cfg]) => this.node(id, cfg));
    }
    if (data.anchors) {
      Object.entries(data.anchors).forEach(([id, pos]) => this.anchor(id, pos));
    }
    if (data.links) {
      Object.entries(data.links).forEach(([id, cfg]) => this.link(id, cfg));
    }
    if (data.acts) {
      data.acts.forEach(a => this.act(a.id, { ...a }));
    }
    if (data.steps) {
      data.steps.forEach(s => this.addStep(s.id, { ...s }));
    }
    if (data.glossary) {
      this.glossary(data.glossary);
    }
    if (data.layers) {
      this.setLayers(data.layers);
    }
    if (data.flowPaths) {
      this.setFlowPaths(data.flowPaths);
    }
    if (data.policyMarkers) {
      this.setPolicyMarkers(data.policyMarkers);
    }
    if (data.zones) {
      this.setZones(data.zones);
    }
    if (data.persistentElements) {
      this._persistentElements = data.persistentElements;
    }

    this._buildIndex();
    if (this._mounted) {
      const container = document.getElementById(this._containerId);
      if (container) {
        container.innerHTML = this._scaffoldHTML();
        this._bindEvents();
        this._buildPips();
        this._buildSidebar();
        this._applyCSSTimings();
        this.render();
      }
    }
    return this;
  }

  /* ══════════════════════════════════════════
     DRAW.IO XML IMPORT (#142)
     Parse a draw.io / diagrams.net XML export and populate the topology.
     ══════════════════════════════════════════ */

  /**
   * Import a draw.io XML string into the topology.
   * Maps mxGraph cells to topology nodes and links.
   *
   * @param {string} xml - draw.io XML content
   * @param {object} [options] - { offsetX, offsetY, typeMap, defaultNodeType, defaultLinkType }
   * @returns {TopologyDesigner} this (for chaining)
   */
  importDrawio(xml, options = {}) {
    const {
      offsetX = 0,
      offsetY = 0,
      typeMap = {},
      defaultNodeType = 'host',
      defaultLinkType = 'line',
      autoAct = true,
    } = options;

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error('draw.io XML parse error:', parseError.textContent);
      return this;
    }

    const cells = doc.querySelectorAll('mxCell');
    const importedNodes = new Map();
    const importedLinks = [];

    // Style parser: "shape=mxgraph.network.server;..." → { shape: 'server', ... }
    const parseStyle = (styleStr) => {
      const out = {};
      if (!styleStr) return out;
      styleStr.split(';').forEach(pair => {
        const eq = pair.indexOf('=');
        if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        else if (pair.trim()) out[pair.trim()] = true;
      });
      return out;
    };

    // Map draw.io shape names to topology node types
    const shapeToType = {
      'mxgraph.network.server': 'server',
      'mxgraph.network.server2': 'server',
      'mxgraph.network.firewall': 'firewall',
      'mxgraph.network.router': 'router',
      'mxgraph.network.switch': 'switch',
      'mxgraph.network.cloud': 'cloud',
      'mxgraph.network.hub': 'switch',
      'mxgraph.network.laptop': 'host',
      'mxgraph.network.desktop': 'host',
      'mxgraph.network.workstation': 'host',
      'mxgraph.network.database': 'database',
      'mxgraph.network.storage': 'database',
      'mxgraph.network.wireless_hub': 'ap',
      'mxgraph.cisco.routers.router': 'router',
      'mxgraph.cisco.switches.layer_3_switch': 'switch',
      'mxgraph.cisco.firewalls.firewall': 'firewall',
      'mxgraph.cisco.servers.standard_server': 'server',
      'mxgraph.cisco.clouds.cloud': 'cloud',
      'ellipse': 'cloud',
      'cylinder3': 'database',
      'hexagon': 'shape:hexagon',
      'triangle': 'shape:triangle',
      'rhombus': 'shape:diamond',
      ...typeMap,
    };

    const inferType = (style) => {
      // Check explicit shape mapping
      if (style.shape) {
        for (const [key, nodeType] of Object.entries(shapeToType)) {
          if (style.shape.includes(key) || style.shape === key) return nodeType;
        }
      }
      // Check style keys for known shapes
      for (const [key, nodeType] of Object.entries(shapeToType)) {
        if (style[key]) return nodeType;
      }
      return defaultNodeType;
    };

    // Pass 1: Extract nodes (cells with geometry but no source/target)
    cells.forEach(cell => {
      const id = cell.getAttribute('id');
      const value = cell.getAttribute('value') || '';
      const source = cell.getAttribute('source');
      const target = cell.getAttribute('target');
      const geo = cell.querySelector('mxGeometry');

      if (source || target) return; // This is an edge
      if (!geo) return;
      if (id === '0' || id === '1') return; // Root/default layer

      const x = parseFloat(geo.getAttribute('x') || '0') + offsetX;
      const y = parseFloat(geo.getAttribute('y') || '0') + offsetY;
      const w = parseFloat(geo.getAttribute('width') || '60');
      const h = parseFloat(geo.getAttribute('height') || '60');
      const style = parseStyle(cell.getAttribute('style') || '');

      // Strip HTML tags from label
      const label = value.replace(/<[^>]*>/g, '').trim();
      const nodeType = inferType(style);
      const nodeId = 'drio-' + id;

      // Extract color from style
      let color = style.fillColor || style.strokeColor || '#01a982';
      if (color === 'none') color = '#01a982';

      this.node(nodeId, {
        type: nodeType,
        x: Math.round(x + w / 2),
        y: Math.round(y + h / 2),
        label: label || nodeId,
        color: color,
        _drawioId: id,
      });

      importedNodes.set(id, nodeId);
    });

    // Pass 2: Extract links (cells with source + target)
    cells.forEach(cell => {
      const source = cell.getAttribute('source');
      const target = cell.getAttribute('target');
      if (!source || !target) return;

      const fromId = importedNodes.get(source);
      const toId = importedNodes.get(target);
      if (!fromId || !toId) return;

      const id = cell.getAttribute('id');
      const value = cell.getAttribute('value') || '';
      const style = parseStyle(cell.getAttribute('style') || '');
      const label = value.replace(/<[^>]*>/g, '').trim();

      let linkType = defaultLinkType;
      if (style.dashed === '1') linkType = 'tunnel';
      if (style.endArrow === 'block' || style.endArrow === 'classic') linkType = 'flow';

      let color = style.strokeColor || '#535c66';
      if (color === 'none') color = '#535c66';

      const linkId = 'drio-link-' + id;
      this.link(linkId, {
        type: linkType,
        from: fromId,
        to: toId,
        color: color,
        label: label || undefined,
      });

      importedLinks.push(linkId);
    });

    // Auto-create an act + step showing all imported elements
    if (autoAct && importedNodes.size > 0) {
      const allIds = [...importedNodes.values(), ...importedLinks];
      this.act('drawio-import', { label: 'Imported Diagram', color: '#65aef9' });
      this.addStep('drawio-overview', {
        act: 'drawio-import',
        name: 'draw.io Import',
        goal: `Imported ${importedNodes.size} nodes and ${importedLinks.length} links from draw.io`,
        phases: [{ show: allIds, diff: 'Full imported topology' }],
      });
    }

    return this;
  }

  /* ══════════════════════════════════════════
     MOBILE QUICK-EDIT MODE (#147)
     Simplified touch-friendly editing interface.
     ══════════════════════════════════════════ */

  /**
   * Enable mobile quick-edit mode.
   * Adds a floating action menu and simplifies interactions for touch devices.
   * @returns {TopologyDesigner} this
   */
  enableMobileQuickEdit() {
    if (this._mobileQuickEditEnabled) return this;
    this._mobileQuickEditEnabled = true;

    const container = document.getElementById(this._containerId);
    if (!container) return this;

    // Create floating action button (FAB)
    const fab = document.createElement('div');
    fab.className = 'tds-mobile-fab';
    fab.innerHTML = '✎';
    fab.title = 'Quick Edit';
    container.appendChild(fab);

    // Create quick-edit panel
    const panel = document.createElement('div');
    panel.className = 'tds-mobile-qe-panel';
    panel.innerHTML = `
      <div class="tds-mobile-qe-header">
        <span>Quick Edit</span>
        <button class="tds-mobile-qe-close">✕</button>
      </div>
      <div class="tds-mobile-qe-body">
        <div class="tds-mobile-qe-section">
          <label>Add Node</label>
          <div class="tds-mobile-qe-types"></div>
        </div>
        <div class="tds-mobile-qe-section">
          <label>Actions</label>
          <button class="tds-mobile-qe-btn" data-action="copy-positions">Copy Positions</button>
          <button class="tds-mobile-qe-btn" data-action="auto-layout">Auto Layout</button>
          <button class="tds-mobile-qe-btn" data-action="export-json">Export JSON</button>
          <button class="tds-mobile-qe-btn" data-action="undo-move">Undo Last Move</button>
        </div>
        <div class="tds-mobile-qe-section tds-mobile-qe-props" style="display:none">
          <label>Selected Node</label>
          <div class="tds-mobile-qe-selected-info"></div>
          <button class="tds-mobile-qe-btn" data-action="delete-node">Delete Node</button>
        </div>
      </div>
    `;
    container.appendChild(panel);

    // Common node types for quick add
    const types = ['ec', 'switch', 'router', 'firewall', 'cloud', 'host', 'server', 'database'];
    const typesContainer = panel.querySelector('.tds-mobile-qe-types');
    const self = this;

    types.forEach(type => {
      const btn = document.createElement('button');
      btn.className = 'tds-mobile-qe-type-btn';
      btn.textContent = type;
      btn.onclick = () => {
        // Place node at center of viewbox
        const vb = self.viewBox.split(' ').map(Number);
        const cx = (vb[2] || 1050) / 2, cy = (vb[3] || 700) / 2;
        const id = 'qe-' + type + '-' + Date.now();
        self.node(id, { type, x: cx, y: cy, label: type.toUpperCase() });
        if (self._mounted) self.render();
      };
      typesContainer.appendChild(btn);
    });

    // FAB toggle
    let panelOpen = false;
    fab.onclick = () => {
      panelOpen = !panelOpen;
      panel.classList.toggle('open', panelOpen);
      fab.classList.toggle('active', panelOpen);
    };

    panel.querySelector('.tds-mobile-qe-close').onclick = () => {
      panelOpen = false;
      panel.classList.remove('open');
      fab.classList.remove('active');
    };

    // Action buttons
    panel.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'copy-positions') self.copyPositions();
        else if (action === 'auto-layout') {
          if (typeof LayoutEngine !== 'undefined') {
            const positions = LayoutEngine.magneticNorth(self._nodes, self._links);
            LayoutEngine.apply(self, positions, true);
          }
        }
        else if (action === 'export-json') {
          const json = JSON.stringify(self.toJSON(), null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = self.title.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
          a.click(); URL.revokeObjectURL(a.href);
        }
        else if (action === 'undo-move' && self._lastMoveUndo) {
          self._lastMoveUndo();
        }
        else if (action === 'delete-node' && self._selectedElement) {
          self._nodes.delete(self._selectedElement);
          if (self._graph) self._graph.removeNode(self._selectedElement);
          self._selectedElement = null;
          panel.querySelector('.tds-mobile-qe-props').style.display = 'none';
          if (self._mounted) self.render();
        }
      };
    });

    // Track node selection for mobile properties panel
    const svg = document.getElementById('tds-diagram');
    if (svg) {
      svg.addEventListener('click', e => {
        if (!self._mobileQuickEditEnabled) return;
        const nodeEl = e.target.closest('[data-tds-node]');
        if (nodeEl) {
          const nodeId = nodeEl.getAttribute('data-tds-node');
          const nodeCfg = self._nodes.get(nodeId);
          if (nodeCfg) {
            self._selectedElement = nodeId;
            const propsSection = panel.querySelector('.tds-mobile-qe-props');
            propsSection.style.display = 'block';
            propsSection.querySelector('.tds-mobile-qe-selected-info').innerHTML =
              `<strong>${_esc(nodeCfg.label || nodeId)}</strong><br>` +
              `<span class="tds-coord-val">Type: ${nodeCfg.type} | x:${nodeCfg.x} y:${nodeCfg.y}</span>`;
          }
        }
      });
    }

    return this;
  }

  /**
   * Disable mobile quick-edit mode.
   * @returns {TopologyDesigner} this
   */
  disableMobileQuickEdit() {
    this._mobileQuickEditEnabled = false;
    const container = document.getElementById(this._containerId);
    if (container) {
      const fab = container.querySelector('.tds-mobile-fab');
      const panel = container.querySelector('.tds-mobile-qe-panel');
      if (fab) fab.remove();
      if (panel) panel.remove();
    }
    return this;
  }

  /* ══════════════════════════════════════════
     SELF-CONTAINED HTML EXPORT + EMBED (#143)
     ══════════════════════════════════════════ */

  /** Generate and download a fully self-contained standalone HTML file */
  async exportStandaloneHTML() {
    try {
      const [cssRes, jsRes] = await Promise.all([
        fetch('topology-ds.css').then(r => r.text()),
        fetch('topology-ds.js').then(r => r.text()),
      ]);
      const data = JSON.stringify(this.toJSON());
      const safeTitle = _esc(this.title);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<!-- Offline font stack: uses local JetBrains Mono/Fira Code/Consolas if installed, no CDN dependency -->
<style>@font-face{font-family:'JetBrains Mono';src:local('JetBrains Mono'),local('Fira Code'),local('Consolas');font-display:swap;} body{font-family:'JetBrains Mono','Fira Code','Consolas','Courier New',monospace;}</style>
<style>
${cssRes}
</style>
</head>
<body>
<div id="topology-container"></div>
<script>
${jsRes}
</script>
<script>
(function(){
  var data = ${data};
  var topo = new TopologyDesigner(data);
  topo.fromJSON(data);
  topo.mount('topology-container');
})();
</script>
</body>
</html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_standalone.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error('Export standalone HTML failed:', e);
    }
  }

  /** Copy an iframe embed code to clipboard and show a toast */
  copyEmbedCode() {
    const safeFile = `${this.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_standalone.html`;
    const embedCode = `<!-- Replace the src with your hosted URL -->\n<iframe src="./${safeFile}" width="100%" height="600" frameborder="0" style="border-radius:12px;border:1px solid #3e4550" loading="lazy" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(embedCode).then(() => {
      const toast = document.createElement('div');
      toast.className = 'tds-toast';
      toast.textContent = 'Embed code copied — paste your hosted URL in the src attribute';
      document.body.appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
    }).catch(err => {
      console.error('Copy failed:', err);
    });
  }

  /* ══════════════════════════════════════════
     ENGAGEMENT ANALYTICS (#145)
     ══════════════════════════════════════════ */

  /** Record an analytics interaction event */
  _trackAnalytics(type, detail) {
    if (!this._analytics) return;
    this._analytics.interactions.push({
      type,
      target: detail || {},
      timestamp: Date.now(),
    });
  }

  /** Record a step view with dwell time tracking */
  _trackStepView(stepId) {
    if (!this._analytics || !stepId) return;
    const now = Date.now();
    // Close out previous step's dwell time
    if (this._analyticsStepStart && this._analyticsLastStep) {
      const elapsed = now - this._analyticsStepStart;
      const entry = this._analytics.stepViews[this._analyticsLastStep];
      if (entry) entry.totalMs += elapsed;
    }
    // Initialize or increment the new step
    if (!this._analytics.stepViews[stepId]) {
      this._analytics.stepViews[stepId] = { count: 0, totalMs: 0 };
    }
    this._analytics.stepViews[stepId].count++;
    this._analyticsStepStart = now;
    this._analyticsLastStep = stepId;
    // Update completion rate
    const totalSteps = this._steps.length || 1;
    this._analytics.totalSteps = totalSteps;
    const uniqueViewed = Object.keys(this._analytics.stepViews).length;
    const furthest = Math.max(...Object.keys(this._analytics.stepViews).map(sid => {
      const idx = this._steps.findIndex(s => s.id === sid);
      return idx >= 0 ? idx + 1 : 0;
    }), 0);
    this._analytics.completionRate = Math.min(furthest / totalSteps, 1);
  }

  /** Return a summary of engagement analytics */
  getAnalytics() {
    const now = Date.now();
    // Close out current step dwell
    if (this._analyticsStepStart && this._analyticsLastStep) {
      const entry = this._analytics.stepViews[this._analyticsLastStep];
      if (entry) entry.totalMs += (now - this._analyticsStepStart);
      this._analyticsStepStart = now; // reset for next call
    }
    const views = this._analytics.stepViews;
    const stepIds = Object.keys(views);
    const totalDwell = stepIds.reduce((sum, k) => sum + views[k].totalMs, 0);
    const totalTransitions = this._analytics.interactions.filter(
      i => i.type === 'next' || i.type === 'prev'
    ).length;
    return {
      sessionDuration: now - this._analytics.startTime,
      stepsViewed: stepIds.length,
      totalStepTransitions: totalTransitions,
      completionRate: this._analytics.completionRate,
      averageStepDwell: stepIds.length ? Math.round(totalDwell / stepIds.length) : 0,
      stepBreakdown: { ...views },
      interactionLog: [...this._analytics.interactions],
    };
  }

  /** Show a glassmorphism analytics dashboard modal */
  showAnalyticsDashboard() {
    const a = this.getAnalytics();
    const durSec = Math.round(a.sessionDuration / 1000);
    const durMin = Math.floor(durSec / 60);
    const durStr = durMin > 0 ? `${durMin}m ${durSec % 60}s` : `${durSec}s`;
    const pct = Math.round(a.completionRate * 100);
    const totalSteps = this._steps.length || 0;
    const avgDwell = a.averageStepDwell > 1000
      ? `${(a.averageStepDwell / 1000).toFixed(1)}s`
      : `${a.averageStepDwell}ms`;

    // Build step bar chart HTML
    const breakdown = a.stepBreakdown;
    const stepIds = Object.keys(breakdown);
    const maxMs = Math.max(...stepIds.map(k => breakdown[k].totalMs), 1);
    const barsHtml = stepIds.map(sid => {
      const pctH = Math.max(4, Math.round((breakdown[sid].totalMs / maxMs) * 100));
      const label = sid.length > 8 ? sid.slice(0, 8) + '..' : sid;
      return `<div style="flex:1;min-width:8px;display:flex;flex-direction:column;align-items:center">
        <div class="tds-analytics-chart-bar" style="height:${pctH}%" title="${sid}: ${Math.round(breakdown[sid].totalMs / 1000)}s (${breakdown[sid].count} views)"></div>
        <div class="tds-analytics-chart-label">${_esc(label)}</div>
      </div>`;
    }).join('');

    const backdrop = document.createElement('div');
    backdrop.className = 'tds-analytics-backdrop';
    backdrop.innerHTML = `
      <div class="tds-analytics-modal">
        <div class="tds-mhead">
          <h3>Engagement Analytics</h3>
          <button style="background:none;border:none;color:var(--tds-muted);cursor:pointer;font-size:16px;padding:4px" onclick="this.closest('.tds-analytics-backdrop').remove()">&times;</button>
        </div>
        <div class="tds-analytics-stat">
          <span class="tds-analytics-stat-label">Session Duration</span>
          <span class="tds-analytics-stat-value">${durStr}</span>
        </div>
        <div class="tds-analytics-stat">
          <span class="tds-analytics-stat-label">Completion</span>
          <span class="tds-analytics-stat-value">${pct}%</span>
        </div>
        <div style="padding:4px 14px">
          <div class="tds-analytics-bar"><div class="tds-analytics-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="tds-analytics-stat">
          <span class="tds-analytics-stat-label">Steps Viewed</span>
          <span class="tds-analytics-stat-value">${a.stepsViewed} / ${totalSteps}</span>
        </div>
        <div class="tds-analytics-stat">
          <span class="tds-analytics-stat-label">Step Transitions</span>
          <span class="tds-analytics-stat-value">${a.totalStepTransitions}</span>
        </div>
        <div class="tds-analytics-stat">
          <span class="tds-analytics-stat-label">Avg Step Dwell</span>
          <span class="tds-analytics-stat-value">${avgDwell}</span>
        </div>
        ${stepIds.length ? `
        <div style="padding:8px 14px 2px;font-size:9px;color:var(--tds-muted);text-transform:uppercase;letter-spacing:.5px">Step Dwell Times</div>
        <div class="tds-analytics-chart">${barsHtml}</div>` : ''}
      </div>`;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    document.body.appendChild(backdrop);
  }

  /* ══════════════════════════════════════════
     AI-ASSISTED AUTHORING (#144)
     ══════════════════════════════════════════ */

  /** Show the AI-assisted authoring modal */
  showAIAssist() {
    // Remove any existing modal
    const existing = document.querySelector('.tds-ai-backdrop');
    if (existing) { existing.remove(); return; }

    const backdrop = document.createElement('div');
    backdrop.className = 'tds-ai-backdrop';

    const chips = [
      '3-tier web app',
      'hub-and-spoke network',
      'mesh VPN topology',
      'microservices architecture',
    ];
    const chipsHtml = chips.map(c =>
      `<button class="tds-ai-chip" data-prompt="${_esc(c)}">${_esc(c)}</button>`
    ).join('');

    backdrop.innerHTML = `
      <div class="tds-ai-modal">
        <div class="tds-mhead">
          <h3>AI-Assisted Topology Generation</h3>
          <button style="background:none;border:none;color:var(--tds-muted);cursor:pointer;font-size:16px;padding:4px" onclick="this.closest('.tds-ai-backdrop').remove()">&times;</button>
        </div>
        <div class="tds-ai-body">
          <textarea class="tds-ai-textarea" placeholder="Describe your network topology in plain English...\nExample: A load balancer connects to 3 app servers, each connects to a shared database"></textarea>
          <div class="tds-ai-chips">${chipsHtml}</div>
          <button class="tds-ai-generate">Generate Topology</button>
          <div class="tds-ai-result">
            <div class="tds-ai-result-summary"></div>
            <button class="tds-ai-apply">Apply to Canvas</button>
          </div>
        </div>
      </div>`;

    const self = this;
    const textarea = backdrop.querySelector('.tds-ai-textarea');
    const resultDiv = backdrop.querySelector('.tds-ai-result');
    const summaryDiv = backdrop.querySelector('.tds-ai-result-summary');
    const applyBtn = backdrop.querySelector('.tds-ai-apply');
    let lastResult = null;

    // Chip clicks fill the textarea
    backdrop.querySelectorAll('.tds-ai-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        textarea.value = chip.dataset.prompt;
      });
    });

    // Generate button
    backdrop.querySelector('.tds-ai-generate').addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) return;
      lastResult = self._parseAITopologyDescription(text);
      summaryDiv.textContent = `Generated ${lastResult.nodes.length} nodes and ${lastResult.links.length} links`;
      resultDiv.classList.add('visible');
    });

    // Apply button
    applyBtn.addEventListener('click', () => {
      if (lastResult) {
        self._applyGeneratedTopology(lastResult);
        backdrop.remove();
      }
    });

    // Click outside to close
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
    textarea.focus();
  }

  /**
   * Parse a natural language topology description into nodes and links.
   * Fully local — no API calls. Uses keyword matching and pattern detection.
   * @param {string} text - Natural language description
   * @returns {{ nodes: Array, links: Array }}
   */
  _parseAITopologyDescription(text) {
    const lower = text.toLowerCase();
    const nodes = [];
    const links = [];
    let idCounter = 1;
    const genId = (prefix) => `${prefix}_${idCounter++}`;
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const numberWords = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
      twenty: 20, thirty: 30, forty: 40,
      'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25, 'twenty-six': 26,
      'twenty-seven': 27, 'twenty-eight': 28, 'twenty-nine': 29,
      'thirty-one': 31, 'thirty-two': 32,
    };
    const parseNumberToken = (token) => {
      if (!token) return null;
      const normalized = token.toLowerCase().trim().replace(/\s+/g, '-');
      if (/^\d+$/.test(normalized)) return parseInt(normalized, 10);
      return numberWords[normalized] ?? null;
    };
    const extractCount = (terms) => {
      for (const term of terms) {
        const match = lower.match(new RegExp(`\\b(\\d+|[a-z]+(?:[- ][a-z]+)?)\\s+${escRe(term)}\\b`, 'i'));
        const value = parseNumberToken(match?.[1]);
        if (Number.isInteger(value)) return value;
      }
      return null;
    };

    // Keyword -> node type mapping
    const typeMap = [
      { keywords: ['load balancer', 'lb', 'balancer'], type: 'ec', label: 'Load Balancer' },
      { keywords: ['firewall', 'fw', 'waf'], type: 'firewall', label: 'Firewall' },
      { keywords: ['database', 'db', 'datastore', 'sql', 'postgres', 'mysql', 'mongo'], type: 'database', label: 'Database' },
      { keywords: ['router', 'gateway', 'gw'], type: 'router', label: 'Router' },
      { keywords: ['switch', 'l2 switch', 'l3 switch'], type: 'switch', label: 'Switch' },
      { keywords: ['cloud', 'aws', 'azure', 'gcp'], type: 'cloud', label: 'Cloud' },
      { keywords: ['server', 'app server', 'web server', 'backend', 'api'], type: 'host', label: 'Server' },
      { keywords: ['client', 'user', 'endpoint', 'laptop', 'desktop', 'workstation'], type: 'ec', label: 'Client' },
    ];

    // Detect topology pattern
    const is3Tier = /3[- ]?tier/i.test(text);
    const isHubSpoke = /hub[- ]?(and[- ]?)?spoke/i.test(text) || (/\bhubs?\b/i.test(text) && /\bspokes?\b/i.test(text));
    const isMesh = /mesh/i.test(text);
    const isStar = /star/i.test(text);

    // Pattern-based generation
    if (is3Tier) {
      const appNodes = [];
      const tierCount = 3;
      const lb = { id: genId('lb'), type: 'ec', label: 'Load Balancer', x: 450, y: 100 };
      nodes.push(lb);
      for (let i = 0; i < tierCount; i++) {
        const app = { id: genId('app'), type: 'host', label: `App Server ${i + 1}`, x: 250 + i * 200, y: 320 };
        nodes.push(app);
        appNodes.push(app);
        links.push({ from: lb.id, to: app.id, type: 'line', label: '' });
      }
      const db = { id: genId('db'), type: 'database', label: 'Database', x: 450, y: 540 };
      nodes.push(db);
      appNodes.forEach(a => links.push({ from: a.id, to: db.id, type: 'line', label: '' }));
    } else if (isHubSpoke || isStar) {
      const explicitHubCount = extractCount(['hub', 'hubs']);
      const explicitSpokeCount = extractCount(['spoke', 'spokes', 'branch', 'branches']);
      const explicitSiteCount = extractCount(['site', 'sites']);
      const hubCount = clamp(explicitHubCount || 1, 1, 8);
      let spokeCount = explicitSpokeCount;
      if (spokeCount == null && explicitSiteCount != null) spokeCount = Math.max(explicitSiteCount - hubCount, 1);
      if (spokeCount == null) spokeCount = 5;
      spokeCount = clamp(spokeCount, 1, 48);

      const simpleDefault = !explicitHubCount && !explicitSpokeCount && !explicitSiteCount && hubCount === 1 && spokeCount === 5;
      const linkType = /sd[- ]?wan|vpn|ztna|sase/i.test(lower) || hubCount > 1 ? 'tunnel' : 'line';
      const hubNodes = [];

      if (simpleDefault) {
        const hub = { id: genId('hub'), type: 'router', label: 'Hub Router', x: 450, y: 350 };
        nodes.push(hub);
        hubNodes.push(hub);
        for (let i = 0; i < spokeCount; i++) {
          const angle = (2 * Math.PI * i) / spokeCount - Math.PI / 2;
          const spoke = {
            id: genId('spoke'), type: 'switch', label: `Site ${i + 1}`,
            x: Math.round(450 + 220 * Math.cos(angle)),
            y: Math.round(350 + 220 * Math.sin(angle)),
          };
          nodes.push(spoke);
          links.push({ from: hub.id, to: spoke.id, type: 'line', label: '' });
        }
      } else {
        const hubY = hubCount === 1 ? 220 : 180;
        for (let i = 0; i < hubCount; i++) {
          const x = hubCount === 1 ? 450 : Math.round(150 + (600 * i) / Math.max(1, hubCount - 1));
          const hub = {
            id: genId('hub'),
            type: /sd[- ]?wan|ztna|sase/i.test(lower) ? 'ec' : 'router',
            label: `Hub ${i + 1}`,
            x,
            y: hubY,
          };
          nodes.push(hub);
          hubNodes.push(hub);
        }

        const cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(spokeCount))));
        const colSpan = cols === 1 ? 0 : 700 / (cols - 1);
        const rowGap = 110;
        const spokeY = hubCount === 1 ? 430 : 400;
        for (let i = 0; i < spokeCount; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const spoke = {
            id: genId('spoke'),
            type: /sd[- ]?wan|ztna|sase/i.test(lower) ? 'ec' : 'switch',
            label: `Spoke Site ${String(i + 1).padStart(2, '0')}`,
            x: Math.round(100 + col * colSpan),
            y: spokeY + row * rowGap,
          };
          nodes.push(spoke);
          const targetHub = hubNodes[i % hubNodes.length];
          links.push({ from: targetHub.id, to: spoke.id, type: linkType, label: hubCount > 1 ? 'Overlay' : '' });
        }

        if (hubNodes.length > 1) {
          for (let i = 0; i < hubNodes.length; i++) {
            for (let j = i + 1; j < hubNodes.length; j++) {
              links.push({ from: hubNodes[i].id, to: hubNodes[j].id, type: 'tunnel', label: 'Hub Mesh' });
            }
          }
        }
      }
    } else if (isMesh) {
      const meshCount = 4;
      const meshNodes = [];
      for (let i = 0; i < meshCount; i++) {
        const angle = (2 * Math.PI * i) / meshCount - Math.PI / 2;
        const n = {
          id: genId('node'), type: 'router', label: `Node ${i + 1}`,
          x: Math.round(450 + 180 * Math.cos(angle)),
          y: Math.round(350 + 180 * Math.sin(angle)),
        };
        nodes.push(n);
        meshNodes.push(n);
      }
      for (let i = 0; i < meshNodes.length; i++) {
        for (let j = i + 1; j < meshNodes.length; j++) {
          links.push({ from: meshNodes[i].id, to: meshNodes[j].id, type: 'tunnel', label: '' });
        }
      }
    } else {
      const mentioned = [];
      for (const tm of typeMap) {
        for (const kw of tm.keywords) {
          const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'gi');
          const matches = lower.match(re);
          if (matches) {
            const countMatch = lower.match(new RegExp('(\\d+)\\s+' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?', 'i'));
            const count = countMatch ? Math.min(parseInt(countMatch[1], 10), 10) : 1;
            for (let c = 0; c < count; c++) {
              mentioned.push({ type: tm.type, label: count > 1 ? `${tm.label} ${c + 1}` : tm.label });
            }
          }
        }
      }
      const cols = Math.ceil(Math.sqrt(mentioned.length));
      mentioned.forEach((m, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        nodes.push({
          id: genId(m.type),
          type: m.type,
          label: m.label,
          x: 200 + col * 200,
          y: 150 + row * 200,
        });
      });
      const connPatterns = /(\w[\w\s]*?)\s+(?:connects?\s+to|linked?\s+to|->|talks?\s+to|communicates?\s+with)\s+(\w[\w\s]*?)(?:[,.]|$)/gi;
      let connMatch;
      while ((connMatch = connPatterns.exec(text)) !== null) {
        const fromLabel = connMatch[1].trim().toLowerCase();
        const toLabel = connMatch[2].trim().toLowerCase();
        const fromNode = nodes.find(n => n.label.toLowerCase().includes(fromLabel));
        const toNode = nodes.find(n => n.label.toLowerCase().includes(toLabel));
        if (fromNode && toNode) {
          links.push({ from: fromNode.id, to: toNode.id, type: 'line', label: '' });
        }
      }
      if (links.length === 0 && nodes.length > 1) {
        for (let i = 0; i < nodes.length - 1; i++) {
          links.push({ from: nodes[i].id, to: nodes[i + 1].id, type: 'line', label: '' });
        }
      }
    }

    if (nodes.length === 0) {
      nodes.push(
        { id: genId('client'), type: 'ec', label: 'Client', x: 200, y: 350 },
        { id: genId('server'), type: 'host', label: 'Server', x: 450, y: 350 },
        { id: genId('db'), type: 'database', label: 'Database', x: 700, y: 350 },
      );
      links.push(
        { from: nodes[0].id, to: nodes[1].id, type: 'line', label: '' },
        { from: nodes[1].id, to: nodes[2].id, type: 'line', label: '' },
      );
    }

    return { nodes, links };
  }

  /**
   * Apply a generated topology result to the current design.
   * @param {{ nodes: Array, links: Array }} result
   */
  _applyGeneratedTopology(result) {
    if (!result) return;
    // Add nodes
    for (const n of result.nodes) {
      this.node(n.id, { type: n.type, label: n.label, x: n.x, y: n.y });
    }
    // Add links — use index suffix to avoid ID collisions when multiple links share endpoints
    for (let i = 0; i < result.links.length; i++) {
      const l = result.links[i];
      let linkId = `${l.from}__${l.to}`;
      if (this._links.has(linkId)) linkId += `__${i}`;
      this.link(linkId, { from: l.from, to: l.to, type: l.type || 'line', label: l.label || '' });
    }
    this.render();
  }

} /* End TopologyDesigner class */

// Support both module and global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TopologyDesigner;
} else if (typeof window !== 'undefined') {
  window.TopologyDesigner = TopologyDesigner;
}
