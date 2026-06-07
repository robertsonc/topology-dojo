/**
 * The flipbook document model.
 *
 * A Document is an ordered list of Pages. Each Page is a COMPLETE, standalone
 * topology frame — like a sheet of transparency film. "Animation" is flipping
 * between pages; there is no delta/override/choreography machinery.
 *
 * Duplicating a page deep-copies it (independent frames): editing one page never
 * changes another. This is the deliberate simplicity of the flipbook model.
 */
import type {
  AnchorConfig,
  LinkConfig,
  NodeConfig,
  RenderablePage,
} from '../vendor/topology-ds.js';

export interface Page extends RenderablePage {
  id: string;
  name: string;
  viewBox: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors: AnchorConfig[];
}

export interface TopologyDocument {
  title: string;
  pages: Page[];
}

let _seq = 0;
/** Monotonic id for new pages (stable within a session). */
export function newPageId(): string {
  return `p${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

/**
 * Deep, independent copy of a page (the flipbook duplicate). The copy gets a new
 * id and an optional new name; nothing is shared with the source.
 */
export function duplicatePage(page: Page, name?: string): Page {
  const copy = structuredClone(page);
  copy.id = newPageId();
  copy.name = name ?? `${page.name} copy`;
  return copy;
}

/** An empty page sized to the standard canvas. */
export function blankPage(name: string): Page {
  return {
    id: newPageId(),
    name,
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
  };
}

/**
 * A seed document: one page with a small SD-WAN frame, so the app shows the
 * legacy visuals immediately. Real authoring (editing on-canvas) arrives in the
 * editor-core phase.
 */
export function sampleDocument(): TopologyDocument {
  const page1: Page = {
    id: newPageId(),
    name: 'Frame 1',
    viewBox: '0 0 1050 700',
    anchors: [],
    nodes: [
      { id: 'user', type: 'host', x: 130, y: 470, label: 'User' },
      {
        id: 'ec',
        type: 'ec',
        x: 330,
        y: 360,
        label: 'EC-Branch',
        color: '#01a982',
      },
      { id: 'fw', type: 'firewall', x: 560, y: 360, label: 'SRX' },
      {
        id: 'hub',
        type: 'ec',
        x: 560,
        y: 180,
        label: 'EC-Hub',
        color: '#01a982',
      },
      {
        id: 'app',
        type: 'server',
        x: 780,
        y: 180,
        label: 'App',
        color: '#deb146',
      },
      {
        id: 'inet',
        type: 'cloud',
        x: 840,
        y: 460,
        label: 'Internet',
        color: '#b1b9be',
      },
    ],
    links: [
      { id: 'lan', type: 'line', from: 'user', to: 'ec' },
      {
        id: 'overlay',
        type: 'tunnel',
        from: 'ec',
        to: 'hub',
        color: '#01a982',
        label: 'IPsec Overlay',
      },
      { id: 'ec-fw', type: 'line', from: 'ec', to: 'fw', color: '#fc6161' },
      { id: 'hub-app', type: 'line', from: 'hub', to: 'app', color: '#deb146' },
      {
        id: 'breakout',
        type: 'line',
        from: 'fw',
        to: 'inet',
        color: '#b1b9be',
      },
    ],
  };
  return { title: 'Untitled', pages: [page1] };
}
