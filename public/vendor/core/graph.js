/* ===================================================================
   TopologyGraph — Graph data model for the Topology Design System

   Replaces flat Map<id, config> storage with a proper graph structure
   that supports adjacency queries, path finding, subgraph extraction,
   and topological operations.

   Maintains backward compatibility: all existing access patterns
   (get, set, has, delete, iterate, size, clear, entries, fromEntries)
   work identically to the raw Maps they replace.
   =================================================================== */

class TopologyGraph {

  constructor() {
    // Primary storage — preserves insertion order, O(1) lookup
    this._nodes = new Map();    // id -> node config
    this._links = new Map();    // id -> link config
    this._anchors = new Map();  // id -> { x, y }

    // Adjacency index — rebuilt on structural changes
    // nodeId -> Set<linkId>  (all links touching this node)
    this._adjacency = new Map();

    // Reverse index: anchorId -> Set<linkId> (links referencing this anchor)
    this._anchorLinks = new Map();

    // Dirty flag — adjacency needs rebuild
    this._adjacencyDirty = false;
  }

  /* ══════════════════════════════════════════
     NODE OPERATIONS
     ══════════════════════════════════════════ */

  /**
   * Add or update a node.
   * @param {string} id
   * @param {object} cfg - { type, x, y, label, sublabel, color, ... }
   * @returns {TopologyGraph} this
   */
  addNode(id, cfg) {
    cfg.id = id;
    this._nodes.set(id, cfg);
    // Don't dirty adjacency for node add — links determine adjacency
    return this;
  }

  /**
   * Get a node config by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  getNode(id) {
    return this._nodes.get(id);
  }

  /**
   * Check if a node exists.
   * @param {string} id
   * @returns {boolean}
   */
  hasNode(id) {
    return this._nodes.has(id);
  }

  /**
   * Remove a node and all links connected to it.
   * @param {string} id
   * @returns {boolean} true if the node existed
   */
  removeNode(id) {
    if (!this._nodes.has(id)) return false;
    // Remove all links connected to this node
    const connectedLinks = this.getLinksForNode(id);
    for (const linkId of connectedLinks) {
      this._links.delete(linkId);
    }
    this._nodes.delete(id);
    this._adjacencyDirty = true;
    return true;
  }

  /** @returns {number} */
  get nodeCount() { return this._nodes.size; }

  /**
   * Iterate all nodes.
   * @returns {IterableIterator<[string, object]>}
   */
  nodes() { return this._nodes.entries(); }

  /** @returns {IterableIterator<[string, object]>} */
  nodeEntries() { return this._nodes.entries(); }

  /** @returns {IterableIterator<string>} */
  nodeIds() { return this._nodes.keys(); }

  /* ══════════════════════════════════════════
     LINK OPERATIONS
     ══════════════════════════════════════════ */

  /**
   * Add or update a link.
   * @param {string} id
   * @param {object} cfg - { type, from, to, color, label, ... }
   * @returns {TopologyGraph} this
   */
  addLink(id, cfg) {
    cfg.id = id;
    this._links.set(id, cfg);
    this._adjacencyDirty = true;
    return this;
  }

  /**
   * Get a link config by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  getLink(id) {
    return this._links.get(id);
  }

  /**
   * Check if a link exists.
   * @param {string} id
   * @returns {boolean}
   */
  hasLink(id) {
    return this._links.has(id);
  }

  /**
   * Remove a link.
   * @param {string} id
   * @returns {boolean} true if the link existed
   */
  removeLink(id) {
    if (!this._links.has(id)) return false;
    this._links.delete(id);
    this._adjacencyDirty = true;
    return true;
  }

  /** @returns {number} */
  get linkCount() { return this._links.size; }

  /**
   * Iterate all links.
   * @returns {IterableIterator<[string, object]>}
   */
  links() { return this._links.entries(); }

  /** @returns {IterableIterator<[string, object]>} */
  linkEntries() { return this._links.entries(); }

  /** @returns {IterableIterator<string>} */
  linkIds() { return this._links.keys(); }

  /* ══════════════════════════════════════════
     ANCHOR OPERATIONS
     ══════════════════════════════════════════ */

  /**
   * Add or update an anchor point.
   * @param {string} id
   * @param {object} pos - { x, y }
   * @returns {TopologyGraph} this
   */
  addAnchor(id, pos) {
    this._anchors.set(id, pos);
    return this;
  }

  /**
   * Get an anchor position by id.
   * @param {string} id
   * @returns {object|undefined} { x, y }
   */
  getAnchor(id) {
    return this._anchors.get(id);
  }

  /**
   * Check if an anchor exists.
   * @param {string} id
   * @returns {boolean}
   */
  hasAnchor(id) {
    return this._anchors.has(id);
  }

  /**
   * Remove an anchor and all links referencing it.
   * Returns the list of removed link IDs.
   * @param {string} id
   * @returns {string[]} removed link IDs, or empty array if anchor didn't exist
   */
  removeAnchor(id) {
    if (!this._anchors.has(id)) return [];
    this._anchors.delete(id);
    const removedLinks = [];
    for (const [linkId, linkCfg] of this._links) {
      if (linkCfg.from === id || linkCfg.to === id) {
        this._links.delete(linkId);
        removedLinks.push(linkId);
      }
    }
    this._adjacencyDirty = true;
    return removedLinks;
  }

  /** @returns {number} */
  get anchorCount() { return this._anchors.size; }

  /**
   * Iterate all anchors.
   * @returns {IterableIterator<[string, object]>}
   */
  anchors() { return this._anchors.entries(); }

  /* ══════════════════════════════════════════
     POSITION RESOLUTION
     ══════════════════════════════════════════ */

  /**
   * Resolve position by id — checks nodes first, then anchors.
   * @param {string} id
   * @returns {{ x: number, y: number } | null}
   */
  resolvePosition(id) {
    const n = this._nodes.get(id);
    if (n) return { x: n.x, y: n.y };
    const a = this._anchors.get(id);
    if (a) return { x: a.x, y: a.y };
    return null;
  }

  /**
   * Check if an id exists as a node, link, or anchor.
   * @param {string} id
   * @returns {'node'|'link'|'anchor'|null}
   */
  elementType(id) {
    if (this._nodes.has(id)) return 'node';
    if (this._links.has(id)) return 'link';
    if (this._anchors.has(id)) return 'anchor';
    return null;
  }

  /* ══════════════════════════════════════════
     ADJACENCY & GRAPH QUERIES
     ══════════════════════════════════════════ */

  /**
   * Rebuild the adjacency index from current links.
   * Called lazily when adjacency is needed and _adjacencyDirty is true.
   */
  _rebuildAdjacency() {
    this._adjacency.clear();
    this._anchorLinks.clear();

    for (const [linkId, cfg] of this._links) {
      const from = cfg.from;
      const to = cfg.to;

      // Index by node endpoints
      if (this._nodes.has(from)) {
        if (!this._adjacency.has(from)) this._adjacency.set(from, new Set());
        this._adjacency.get(from).add(linkId);
      }
      if (this._nodes.has(to)) {
        if (!this._adjacency.has(to)) this._adjacency.set(to, new Set());
        this._adjacency.get(to).add(linkId);
      }

      // Index by anchor endpoints
      if (this._anchors.has(from)) {
        if (!this._anchorLinks.has(from)) this._anchorLinks.set(from, new Set());
        this._anchorLinks.get(from).add(linkId);
      }
      if (this._anchors.has(to)) {
        if (!this._anchorLinks.has(to)) this._anchorLinks.set(to, new Set());
        this._anchorLinks.get(to).add(linkId);
      }
    }

    this._adjacencyDirty = false;
  }

  /**
   * Get all link IDs connected to a node.
   * @param {string} nodeId
   * @returns {Set<string>}
   */
  getLinksForNode(nodeId) {
    if (this._adjacencyDirty) this._rebuildAdjacency();
    return this._adjacency.get(nodeId) || new Set();
  }

  /**
   * Get all link IDs referencing an anchor.
   * @param {string} anchorId
   * @returns {Set<string>}
   */
  getLinksForAnchor(anchorId) {
    if (this._adjacencyDirty) this._rebuildAdjacency();
    return this._anchorLinks.get(anchorId) || new Set();
  }

  /**
   * Get neighbor node IDs for a given node (nodes connected by links).
   * @param {string} nodeId
   * @returns {Set<string>}
   */
  getNeighbors(nodeId) {
    const neighbors = new Set();
    const linkIds = this.getLinksForNode(nodeId);
    for (const linkId of linkIds) {
      const link = this._links.get(linkId);
      if (!link) continue;
      const other = link.from === nodeId ? link.to : link.from;
      if (this._nodes.has(other)) {
        neighbors.add(other);
      }
    }
    return neighbors;
  }

  /**
   * Get the degree of a node (number of links connected to it).
   * @param {string} nodeId
   * @returns {number}
   */
  degree(nodeId) {
    return this.getLinksForNode(nodeId).size;
  }

  /**
   * Get all links between two specific nodes.
   * @param {string} nodeA
   * @param {string} nodeB
   * @returns {string[]} link IDs
   */
  getLinksBetween(nodeA, nodeB) {
    const linksA = this.getLinksForNode(nodeA);
    const result = [];
    for (const linkId of linksA) {
      const link = this._links.get(linkId);
      if (!link) continue;
      if ((link.from === nodeA && link.to === nodeB) ||
          (link.from === nodeB && link.to === nodeA)) {
        result.push(linkId);
      }
    }
    return result;
  }

  /* ══════════════════════════════════════════
     GRAPH ALGORITHMS
     ══════════════════════════════════════════ */

  /**
   * Breadth-first search from a starting node.
   * Returns an array of node IDs in BFS order.
   * @param {string} startId
   * @returns {string[]}
   */
  bfs(startId) {
    if (!this._nodes.has(startId)) return [];
    const visited = new Set([startId]);
    const queue = [startId];
    const order = [];

    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      for (const neighbor of this.getNeighbors(current)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return order;
  }

  /**
   * Find shortest path between two nodes (unweighted BFS).
   * Returns array of node IDs forming the path, or empty array if no path.
   * @param {string} fromId
   * @param {string} toId
   * @returns {string[]}
   */
  shortestPath(fromId, toId) {
    if (!this._nodes.has(fromId) || !this._nodes.has(toId)) return [];
    if (fromId === toId) return [fromId];

    const visited = new Set([fromId]);
    const queue = [[fromId]];

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      for (const neighbor of this.getNeighbors(current)) {
        if (neighbor === toId) return [...path, neighbor];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return []; // No path found
  }

  /**
   * Find all connected components in the graph.
   * Returns array of Sets, each containing node IDs in one component.
   * @returns {Set<string>[]}
   */
  connectedComponents() {
    const visited = new Set();
    const components = [];

    for (const nodeId of this._nodes.keys()) {
      if (visited.has(nodeId)) continue;
      const component = new Set();
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift();
        component.add(current);
        for (const neighbor of this.getNeighbors(current)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    return components;
  }

  /**
   * Find articulation points (nodes whose removal disconnects the graph).
   * These are single points of failure.
   * @returns {string[]} node IDs that are articulation points
   */
  articulationPoints() {
    const nodes = [...this._nodes.keys()];
    if (nodes.length <= 2) return [];

    const result = [];
    // Simple approach: for each node, check if removing it increases components
    const baseComponents = this.connectedComponents().length;

    for (const nodeId of nodes) {
      // Temporarily remove node and check connectivity
      const neighbors = this.getNeighbors(nodeId);
      if (neighbors.size < 2) continue; // Leaf nodes can't be articulation points

      // BFS from a neighbor, excluding nodeId
      const startNeighbor = neighbors.values().next().value;
      const visited = new Set([nodeId]); // Pretend nodeId doesn't exist
      visited.add(startNeighbor);
      const queue = [startNeighbor];

      while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbor of this.getNeighbors(current)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // If not all neighbors were reached, this is an articulation point
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          result.push(nodeId);
          break;
        }
      }
    }

    return result;
  }

  /**
   * Find bridge links (links whose removal disconnects the graph).
   * These are single points of failure at the link level.
   * @returns {string[]} link IDs that are bridges
   */
  bridges() {
    const result = [];
    const baseComponents = this.connectedComponents().length;

    for (const [linkId, cfg] of this._links) {
      // Only consider links between nodes (not anchors)
      if (!this._nodes.has(cfg.from) || !this._nodes.has(cfg.to)) continue;

      // Check if there's another path between from and to without this link
      // Temporarily "remove" the link by checking paths excluding it
      const parallelLinks = this.getLinksBetween(cfg.from, cfg.to);
      if (parallelLinks.length > 1) continue; // Redundant links can't be bridges

      // BFS from cfg.from to cfg.to, excluding this link
      const visited = new Set([cfg.from]);
      const queue = [cfg.from];
      let found = false;

      while (queue.length > 0 && !found) {
        const current = queue.shift();
        const currentLinks = this.getLinksForNode(current);
        for (const lid of currentLinks) {
          if (lid === linkId) continue; // Skip the bridge candidate
          const link = this._links.get(lid);
          if (!link) continue;
          const neighbor = link.from === current ? link.to : link.from;
          if (!this._nodes.has(neighbor)) continue;
          if (neighbor === cfg.to) { found = true; break; }
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      if (!found) result.push(linkId);
    }
    return result;
  }

  /**
   * Get the blast radius of a node failure — all nodes that would lose
   * connectivity to the rest of the network if this node goes down.
   * @param {string} nodeId - the failing node
   * @returns {{ isolated: Set<string>, affected: Set<string> }}
   *   isolated: nodes that become completely unreachable
   *   affected: nodes whose path to other parts of the network changes
   */
  blastRadius(nodeId) {
    if (!this._nodes.has(nodeId)) return { isolated: new Set(), affected: new Set() };

    // Get components with the node present
    const componentsBefore = this.connectedComponents();
    let originalComponent = null;
    for (const comp of componentsBefore) {
      if (comp.has(nodeId)) { originalComponent = comp; break; }
    }
    if (!originalComponent) return { isolated: new Set(), affected: new Set() };

    // Simulate removal: BFS from each neighbor of nodeId, excluding nodeId.
    // Build separate reachable sets — if neighbors can't reach each other,
    // the graph has split.
    const neighbors = [...this.getNeighbors(nodeId)];
    if (neighbors.length === 0) return { isolated: new Set(), affected: new Set() };

    // Assign each neighbor to a "fragment" — a connected component after removal.
    // Use union-find style: BFS from first unvisited neighbor, mark all reachable.
    const fragments = []; // Array of Set<nodeId>
    const globalVisited = new Set([nodeId]); // Exclude the failed node

    for (const neighbor of neighbors) {
      if (globalVisited.has(neighbor)) continue; // Already reached from another neighbor
      const fragment = new Set();
      const queue = [neighbor];
      globalVisited.add(neighbor);
      while (queue.length > 0) {
        const current = queue.shift();
        fragment.add(current);
        for (const n of this.getNeighbors(current)) {
          if (!globalVisited.has(n)) {
            globalVisited.add(n);
            queue.push(n);
          }
        }
      }
      fragments.push(fragment);
    }

    // If only one fragment, the graph didn't split — nothing is isolated
    if (fragments.length <= 1) {
      const affected = new Set(neighbors);
      return { isolated: new Set(), affected };
    }

    // Multiple fragments: the largest one is the "main" network.
    // Smaller fragments are isolated.
    fragments.sort((a, b) => b.size - a.size);
    const mainFragment = fragments[0];

    const isolated = new Set();
    const affected = new Set();
    for (let i = 1; i < fragments.length; i++) {
      for (const n of fragments[i]) isolated.add(n);
    }

    // Affected = direct neighbors in the main fragment (they lose a connection)
    for (const n of neighbors) {
      if (mainFragment.has(n)) affected.add(n);
    }

    return { isolated, affected };
  }

  /* ══════════════════════════════════════════
     SUBGRAPH EXTRACTION
     ══════════════════════════════════════════ */

  /**
   * Extract a subgraph containing only the specified node IDs
   * and links between them.
   * @param {Set<string>|string[]} nodeIds
   * @returns {{ nodes: Map, links: Map, anchors: Map }}
   */
  subgraph(nodeIds) {
    const ids = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
    const subNodes = new Map();
    const subLinks = new Map();
    const subAnchors = new Map();

    for (const id of ids) {
      const node = this._nodes.get(id);
      if (node) subNodes.set(id, node);
    }

    for (const [linkId, cfg] of this._links) {
      const fromIsNode = ids.has(cfg.from);
      const toIsNode = ids.has(cfg.to);
      const fromIsAnchor = this._anchors.has(cfg.from);
      const toIsAnchor = this._anchors.has(cfg.to);

      // Include link if both endpoints are in the subgraph (or are anchors)
      if ((fromIsNode || fromIsAnchor) && (toIsNode || toIsAnchor)) {
        if (fromIsNode || toIsNode) {
          subLinks.set(linkId, cfg);
          // Include referenced anchors
          if (fromIsAnchor) subAnchors.set(cfg.from, this._anchors.get(cfg.from));
          if (toIsAnchor) subAnchors.set(cfg.to, this._anchors.get(cfg.to));
        }
      }
    }

    return { nodes: subNodes, links: subLinks, anchors: subAnchors };
  }

  /* ══════════════════════════════════════════
     TOPOLOGY ANALYSIS
     ══════════════════════════════════════════ */

  /**
   * Analyze the topology for common issues.
   * Returns an array of findings.
   * @returns {Array<{ type: string, severity: string, message: string, elements: string[] }>}
   */
  analyze() {
    const findings = [];

    // Single points of failure — articulation points
    const artPoints = this.articulationPoints();
    for (const nodeId of artPoints) {
      const node = this._nodes.get(nodeId);
      const label = node?.label || nodeId;
      findings.push({
        type: 'single-point-of-failure',
        severity: 'critical',
        message: `Node "${label}" is a single point of failure — its removal disconnects the graph`,
        elements: [nodeId],
      });
    }

    // Bridge links
    const bridgeLinks = this.bridges();
    for (const linkId of bridgeLinks) {
      const link = this._links.get(linkId);
      findings.push({
        type: 'bridge-link',
        severity: 'warning',
        message: `Link "${linkId}" (${link.from} → ${link.to}) has no redundant path`,
        elements: [linkId, link.from, link.to],
      });
    }

    // Isolated nodes (degree 0)
    for (const nodeId of this._nodes.keys()) {
      if (this.degree(nodeId) === 0) {
        const node = this._nodes.get(nodeId);
        findings.push({
          type: 'isolated-node',
          severity: 'info',
          message: `Node "${node?.label || nodeId}" has no connections`,
          elements: [nodeId],
        });
      }
    }

    // Disconnected components
    const components = this.connectedComponents();
    if (components.length > 1) {
      findings.push({
        type: 'disconnected-graph',
        severity: 'warning',
        message: `Topology has ${components.length} disconnected components`,
        elements: components.map(c => [...c][0]),
      });
    }

    return findings;
  }

  /* ══════════════════════════════════════════
     SERIALIZATION
     ══════════════════════════════════════════ */

  /**
   * Serialize the graph to a plain object.
   * Compatible with TopologyDesigner.toJSON() format.
   */
  toJSON() {
    return {
      nodes: Object.fromEntries(this._nodes),
      links: Object.fromEntries(this._links),
      anchors: Object.fromEntries(this._anchors),
    };
  }

  /**
   * Load graph data from a plain object.
   * @param {object} data - { nodes, links, anchors }
   */
  fromJSON(data) {
    this.clear();
    if (data.nodes) {
      for (const [id, cfg] of Object.entries(data.nodes)) {
        this.addNode(id, cfg);
      }
    }
    if (data.links) {
      for (const [id, cfg] of Object.entries(data.links)) {
        this.addLink(id, cfg);
      }
    }
    if (data.anchors) {
      for (const [id, pos] of Object.entries(data.anchors)) {
        this.addAnchor(id, pos);
      }
    }
    return this;
  }

  /**
   * Clear all data.
   */
  clear() {
    this._nodes.clear();
    this._links.clear();
    this._anchors.clear();
    this._adjacency.clear();
    this._anchorLinks.clear();
    this._adjacencyDirty = false;
  }

  /* ══════════════════════════════════════════
     BACKWARD-COMPATIBLE ACCESSORS
     These expose the raw Maps so that TopologyDesigner
     can migrate incrementally without breaking changes.
     ══════════════════════════════════════════ */

  /** @returns {Map} Raw nodes Map (for backward compat) */
  get rawNodes() { return this._nodes; }

  /** @returns {Map} Raw links Map (for backward compat) */
  get rawLinks() { return this._links; }

  /** @returns {Map} Raw anchors Map (for backward compat) */
  get rawAnchors() { return this._anchors; }
}

// Support both module and global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TopologyGraph;
} else if (typeof window !== 'undefined') {
  window.TopologyGraph = TopologyGraph;
}
