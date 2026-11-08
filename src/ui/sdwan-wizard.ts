/**
 * "Generate SD-WAN topology" wizard — a modal front end for
 * `generateSdwan` (src/connect/generate.ts). Every control edits one
 * `SdwanIntent`; each change regenerates the document and re-renders a live
 * preview with its device / tunnel / link counts, so the numbers shown are the
 * numbers that land on the canvas. The modal owns no persisted state: Create
 * hands the generated document to the caller, which loads it like a template.
 */
import {
  DEFAULT_REGION_NAMES,
  generateSdwan,
  SDWAN_LIMITS,
  type BranchLan,
  type DetailLevel,
  type SdwanIntent,
  type SdwanResult,
  type SdwanVendor,
  type Transport,
} from '../connect/generate.js';
import type { TopologyDocument } from '../pages/model.js';
import { registerOverlay } from './overlay.js';

export interface SdwanWizardHost {
  /** Element the backdrop is appended to (the app root). */
  mount: HTMLElement;
  /** Render a generated document's first page to a standalone SVG string. */
  render: (doc: TopologyDocument) => string;
  /** Called with the generated document when the user presses Create. */
  onCreate: (doc: TopologyDocument) => void;
}

/** Above this many visible tunnels the preview suggests the site view. */
const DENSE_TUNNELS = 120;

interface Choice<T> {
  value: T;
  label: string;
}

const range = (min: number, max: number): Choice<number>[] =>
  Array.from({ length: max - min + 1 }, (_, k) => ({
    value: min + k,
    label: String(min + k),
  }));

const TRANSPORT_CHOICES: Choice<Transport>[] = [
  { value: 'inet', label: 'Internet' },
  { value: 'mpls', label: 'MPLS' },
  { value: 'lte', label: 'LTE' },
];

const VENDOR_NOTE: Record<SdwanVendor, string> = {
  edgeconnect:
    'Underlay tunnels per matching WAN label (hidden layer) plus one bonded overlay per appliance pair. Both HA members build tunnels.',
  juniper:
    'SRX with Mist WAN Assurance: one IPsec overlay per WAN path to each hub. A chassis cluster terminates tunnels once (node0).',
};

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

let open: { close: () => void } | null = null;

/** Open the wizard (no-op if it is already open). */
export function openSdwanWizard(host: SdwanWizardHost): void {
  if (open) return;
  const intent: Required<
    Pick<
      SdwanIntent,
      | 'vendor'
      | 'detail'
      | 'regions'
      | 'hubsPerRegion'
      | 'branchHa'
      | 'branchLan'
      | 'interRegionHubMesh'
    >
  > & {
    /** Branch count per region slot (all four kept, so shrinking and
     * re-growing the region count does not forget an entry). */
    branches: number[];
    names: string[];
    transports: Transport[];
  } = {
    vendor: 'edgeconnect',
    detail: 'device',
    regions: 1,
    hubsPerRegion: 2,
    branches: [4, 4, 4, 4],
    names: [...DEFAULT_REGION_NAMES],
    transports: ['inet'],
    branchHa: false,
    branchLan: 'none',
    interRegionHubMesh: true,
  };
  let result: SdwanResult | null = null;

  const root = document.createElement('div');
  root.className = 'help-backdrop';
  root.innerHTML =
    `<div class="help-card sdw-card scroll-slim" role="dialog" aria-modal="true" aria-labelledby="sdwTitle">` +
    `<div class="help-head"><h3 id="sdwTitle">Generate SD-WAN topology</h3>` +
    `<button class="tbtn ticon" data-act="close" title="Close (Esc)" aria-label="Close">✕</button></div>` +
    `<div class="sdw-body"><div class="sdw-form"></div>` +
    `<div class="sdw-side"><div class="sdw-preview" aria-hidden="true"></div>` +
    `<div class="sdw-stats" role="status" aria-live="polite"></div>` +
    `<p class="sdw-note"></p></div></div>` +
    `<div class="sdw-foot"><button class="tbtn" data-act="close">Cancel</button>` +
    `<button class="tbtn sdw-create" data-act="create">Create diagram</button></div></div>`;
  const form = root.querySelector<HTMLElement>('.sdw-form')!;
  const preview = root.querySelector<HTMLElement>('.sdw-preview')!;
  const stats = root.querySelector<HTMLElement>('.sdw-stats')!;
  const note = root.querySelector<HTMLElement>('.sdw-note')!;
  const createBtn = root.querySelector<HTMLButtonElement>('.sdw-create')!;

  const group = <T>(
    label: string,
    choices: Choice<T>[],
    current: T,
    set: (v: T) => void,
  ): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'sdw-q';
    const id = `sdw-${Math.random().toString(36).slice(2, 8)}`;
    wrap.innerHTML =
      `<div class="sdw-label" id="${id}">${escapeHtml(label)}</div>` +
      `<div class="sdw-seg" role="group" aria-labelledby="${id}"></div>`;
    const seg = wrap.querySelector<HTMLElement>('.sdw-seg')!;
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tbtn sdw-opt';
      b.textContent = c.label;
      b.setAttribute('aria-pressed', String(c.value === current));
      b.addEventListener('click', () => {
        set(c.value);
        update();
      });
      seg.appendChild(b);
    }
    return wrap;
  };

  /** Name + branch count per region. Edits regenerate the preview without
   * rebuilding the form, so typing keeps focus. */
  const regionRows = (): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'sdw-q';
    wrap.innerHTML =
      `<div class="sdw-label" id="sdw-regions">Regions: name and branches</div>` +
      `<div class="sdw-regions" role="group" aria-labelledby="sdw-regions"></div>`;
    const rows = wrap.querySelector<HTMLElement>('.sdw-regions')!;
    for (let r = 0; r < intent.regions; r++) {
      const row = document.createElement('div');
      row.className = 'sdw-region';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'sdw-region-name';
      name.maxLength = 24;
      name.value = intent.names[r]!;
      name.placeholder = DEFAULT_REGION_NAMES[r]!;
      name.setAttribute('aria-label', `Region ${r + 1} name`);
      name.addEventListener('input', () => {
        intent.names[r] = name.value;
        regenerate();
      });
      const count = document.createElement('select');
      count.className = 'tbtn sdw-region-count';
      count.setAttribute('aria-label', `Region ${r + 1} branches`);
      for (const c of range(
        SDWAN_LIMITS.branchesPerRegion.min,
        SDWAN_LIMITS.branchesPerRegion.max,
      ))
        count.add(new Option(`${c.label} branches`, String(c.value)));
      count.value = String(intent.branches[r]);
      count.addEventListener('change', () => {
        intent.branches[r] = Number(count.value);
        regenerate();
      });
      row.append(name, count);
      rows.appendChild(row);
    }
    return wrap;
  };

  const buildForm = (): void => {
    const haLabel =
      intent.vendor === 'edgeconnect' ? 'HA pair' : 'Chassis cluster';
    form.replaceChildren(
      group<SdwanVendor>(
        'Vendor',
        [
          { value: 'edgeconnect', label: 'HPE EdgeConnect' },
          { value: 'juniper', label: 'Juniper SRX' },
        ],
        intent.vendor,
        (v) => (intent.vendor = v),
      ),
      group<DetailLevel>(
        'How much detail?',
        [
          { value: 'device', label: 'Every device' },
          { value: 'site', label: 'One box per site' },
          { value: 'overview', label: 'Overview + region pages' },
        ],
        intent.detail,
        (v) => (intent.detail = v),
      ),
      group(
        'Regions',
        range(SDWAN_LIMITS.regions.min, SDWAN_LIMITS.regions.max),
        intent.regions,
        (v) => (intent.regions = v),
      ),
      ...(intent.regions > 1
        ? [
            group(
              'Mesh hubs across regions?',
              [
                { value: true, label: 'Yes' },
                { value: false, label: 'No' },
              ],
              intent.interRegionHubMesh,
              (v) => (intent.interRegionHubMesh = v),
            ),
          ]
        : []),
      group(
        'Hubs per region',
        [
          { value: 1, label: '1' },
          { value: 2, label: '2 (independent)' },
        ],
        intent.hubsPerRegion,
        (v) => (intent.hubsPerRegion = v),
      ),
      intent.regions === 1
        ? group(
            'Branches per region',
            range(
              SDWAN_LIMITS.branchesPerRegion.min,
              SDWAN_LIMITS.branchesPerRegion.max,
            ),
            intent.branches[0]!,
            (v) => (intent.branches[0] = v),
          )
        : regionRows(),
      group(
        'WAN links per branch',
        range(SDWAN_LIMITS.wanLinks.min, SDWAN_LIMITS.wanLinks.max),
        intent.transports.length,
        (n) => {
          const next = intent.transports.slice(0, n);
          const fill: Transport[] = ['inet', 'mpls', 'lte'];
          while (next.length < n) next.push(fill[next.length] ?? 'inet');
          intent.transports = next;
        },
      ),
      ...intent.transports.map((t, k) =>
        group(`WAN ${k + 1} type`, TRANSPORT_CHOICES, t, (v) => {
          intent.transports[k] = v;
        }),
      ),
      group(
        'Branch edge',
        [
          { value: false, label: 'Single' },
          { value: true, label: haLabel },
        ],
        intent.branchHa,
        (v) => (intent.branchHa = v),
      ),
      // Overview region pages are device detail, so LAN applies there too.
      ...(intent.detail !== 'site'
        ? [
            group<BranchLan>(
              'Branch LAN',
              [
                { value: 'none', label: 'None' },
                { value: 'switch', label: 'Switch' },
                { value: 'switch-ap', label: 'Switch + AP' },
              ],
              intent.branchLan,
              (v) => (intent.branchLan = v),
            ),
          ]
        : []),
    );
  };

  const update = (): void => {
    // Rebuilding keeps conditional questions (mesh, per-WAN type, LAN) in step;
    // keep keyboard focus on the same option across the rebuild.
    const focused = document.activeElement;
    const opts = [...form.querySelectorAll('.sdw-opt')];
    const focusIx = focused ? opts.indexOf(focused) : -1;
    const focusText = focused?.textContent;
    buildForm();
    if (focusIx >= 0) {
      const now = [...form.querySelectorAll<HTMLElement>('.sdw-opt')];
      const same =
        now[focusIx]?.textContent === focusText
          ? now[focusIx]
          : now.find((b) => b.textContent === focusText);
      same?.focus();
    }
    regenerate();
  };

  /** Regenerate the document, preview and counts from the current intent. */
  const regenerate = (): void => {
    try {
      result = generateSdwan({
        vendor: intent.vendor,
        detail: intent.detail,
        regions: intent.regions,
        regionNames: intent.names.slice(0, intent.regions),
        hubsPerRegion: intent.hubsPerRegion,
        branchesPerRegion: intent.branches.slice(0, intent.regions),
        transports: intent.transports,
        branchHa: intent.branchHa,
        branchLan: intent.branchLan,
        interRegionHubMesh: intent.interRegionHubMesh,
      });
    } catch (err) {
      result = null;
      stats.textContent = err instanceof Error ? err.message : String(err);
      preview.replaceChildren();
      createBtn.disabled = true;
      return;
    }
    createBtn.disabled = false;
    preview.innerHTML = host.render(result.doc);
    const s = result.stats;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const tunnels =
      s.underlayTunnels > 0
        ? `${plural(s.overlayTunnels, 'overlay tunnel')} · ${s.underlayTunnels} underlay (hidden layer)`
        : plural(s.tunnels, 'tunnel');
    const pages = s.pages > 1 ? ` · ${s.pages} pages` : '';
    stats.textContent = `${plural(s.devices, 'device')} · ${tunnels} · ${plural(s.links, 'cable')}${pages}`;
    note.textContent =
      intent.detail === 'device' && s.overlayTunnels > DENSE_TUNNELS
        ? `Dense: ${s.overlayTunnels} visible tunnels. "One box per site" or "Overview + region pages" reads better at this size.`
        : intent.detail === 'overview'
          ? `Preview shows the overview page. Ctrl/Cmd+click a site to open its region's device page; each region page links back. ${VENDOR_NOTE[intent.vendor]}`
          : VENDOR_NOTE[intent.vendor];
  };

  let release: () => void = () => {};
  const close = (): void => {
    root.remove();
    release();
    open = null;
  };
  root.addEventListener('click', (e) => {
    if (e.target === root) return close();
    const act = (e.target as HTMLElement)
      .closest<HTMLElement>('[data-act]')
      ?.getAttribute('data-act');
    if (act === 'close') close();
    else if (act === 'create' && result) {
      const doc = result.doc;
      close();
      host.onCreate(doc);
    }
  });

  update();
  host.mount.appendChild(root);
  open = { close };
  release = registerOverlay(root, {
    close,
    initialFocus: form.querySelector<HTMLElement>(
      '.sdw-opt[aria-pressed="true"]',
    ),
  });
}
