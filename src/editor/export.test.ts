import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_URL_TTL_MS,
  downloadBlob,
  exportPageSVG,
  pageToSVG,
  svgToPngBlob,
} from './export.js';
import type { Page } from '../pages/model.js';

// The wrapper/backdrop framing is what's under test — the art itself needs the
// browser-loaded engine, so stub it out.
vi.mock('../vendor/topology-ds.js', () => ({
  renderPageSVG: () => '<g data-art/>',
}));

function page(viewBox: string): Page {
  return {
    id: 'p1',
    name: 'Frame 1',
    viewBox,
    nodes: [{ id: 'a', type: 'ec', x: 200, y: 120, label: 'A' }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

describe('pageToSVG backdrop framing', () => {
  it('covers a zero-origin viewBox from (0,0)', () => {
    const svg = pageToSVG(page('0 0 1050 700'));
    expect(svg).toContain('viewBox="0 0 1050 700"');
    expect(svg).toContain('<rect x="0" y="0" width="1050" height="700"');
  });

  it('positions the backdrop at a positive non-zero origin', () => {
    // fit-to-content can legitimately produce origins like this; the backdrop
    // must cover 82,40 → 982,660, not 0,0 → 900,620.
    const svg = pageToSVG(page('82 40 900 620'));
    expect(svg).toContain('<rect x="82" y="40" width="900" height="620"');
  });

  it('positions the backdrop at a negative origin', () => {
    const svg = pageToSVG(page('-120 -60 800 500'));
    expect(svg).toContain('<rect x="-120" y="-60" width="800" height="500"');
    // wrapper still rasterizes at the viewBox size
    expect(svg).toContain('width="800" height="500"><rect');
  });
});

/** Minimal document/URL stand-ins — the repo's vitest env is Node, not jsdom. */
function installDownloadDom() {
  const clicks: string[] = [];
  const appended: unknown[] = [];
  const createdUrls: string[] = [];
  const revoked: string[] = [];
  type Anchor = {
    href: string;
    download: string;
    rel: string;
    style: { display: string };
    click: () => void;
    remove: () => void;
    setAttribute: (name: string, value: string) => void;
  };
  const anchors: Anchor[] = [];

  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${createdUrls.length}/${blob.size}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });

  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'a') throw new Error(`unexpected element ${tag}`);
      const el: Anchor = {
        href: '',
        download: '',
        rel: '',
        style: { display: '' },
        click() {
          clicks.push(el.download);
        },
        remove() {
          const i = appended.indexOf(el);
          if (i >= 0) appended.splice(i, 1);
        },
        setAttribute() {},
      };
      anchors.push(el);
      return el;
    },
    body: {
      appendChild(el: unknown) {
        appended.push(el);
        return el;
      },
    },
  });

  return { clicks, appended, createdUrls, revoked, anchors };
}

describe('downloadBlob (#222)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('throws before touching the DOM when the file is empty or unnamed', () => {
    expect(() => downloadBlob('frame.svg', new Blob())).toThrow(/empty file/);
    expect(() =>
      downloadBlob('  ', new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    ).toThrow(/filename/);
  });

  it('throws when there is no document to attach the download link', () => {
    vi.stubGlobal('document', { body: null });
    expect(() =>
      downloadBlob(
        'frame.svg',
        new Blob(['<svg/>'], { type: 'image/svg+xml' }),
      ),
    ).toThrow(/browser document/);
  });

  it('clicks an in-document link and keeps the object URL until after the click', () => {
    vi.useFakeTimers();
    const { clicks, appended, createdUrls, revoked, anchors } =
      installDownloadDom();
    const blob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
      type: 'image/svg+xml',
    });

    downloadBlob('topology_Frame_1.svg', blob);

    expect(createdUrls).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(anchors[0]?.href).toBe(createdUrls[0]);
    expect(anchors[0]?.download).toBe('topology_Frame_1.svg');
    expect(clicks).toEqual(['topology_Frame_1.svg']);
    // The old helper revoked in the same turn as click(); Chrome can then
    // drop the download with no error. The URL must still be alive here.
    expect(revoked).toEqual([]);

    vi.advanceTimersByTime(DOWNLOAD_URL_TTL_MS - 1);
    expect(revoked).toEqual([]);
    expect(appended).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(createdUrls);
    expect(appended).toEqual([]);
  });
});

describe('exportPageSVG', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('offers a non-empty SVG download for a populated page', () => {
    vi.useFakeTimers();
    const { clicks, createdUrls } = installDownloadDom();
    exportPageSVG('frame.svg', page('0 0 1050 700'));
    expect(clicks).toEqual(['frame.svg']);
    expect(createdUrls[0]).toMatch(/blob:test\/0\/[1-9]\d*/);
  });
});

describe('svgToPngBlob', () => {
  it('rejects markup that is not an SVG', async () => {
    await expect(svgToPngBlob('not-an-image')).rejects.toThrow(
      /invalid markup/,
    );
  });
});
