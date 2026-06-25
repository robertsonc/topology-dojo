import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * Cache-bust the vendored engine/theme.
 *
 * The vendored files live at stable, un-fingerprinted URLs under /vendor/ and are
 * served `immutable` for a year (see public/_headers) — a big repeat-visit win,
 * but it means a re-vendored engine never reaches browsers that cached the old
 * one (they keep the stale copy until the cache expires). The app bundle is
 * hashed by Vite so it always refreshes; the raw `<script src="/vendor/…">` tags
 * are not, so the engine could silently lag the UI after a re-vendor.
 *
 * Fix: append `?v=<content-hash>` to every /vendor/ reference in index.html at
 * build time. The hash changes only when the file's bytes change, so `immutable`
 * caching stays effective AND a re-vendor busts the URL → browsers fetch fresh.
 */
function vendorCacheBust(): Plugin {
  return {
    name: 'vendor-cache-bust',
    transformIndexHtml(html) {
      return html.replace(
        /\b(href|src)="(\/vendor\/[^"?]+)"/g,
        (whole, attr: string, url: string) => {
          try {
            const bytes = readFileSync(`${ROOT}public${url}`);
            const hash = createHash('sha256')
              .update(bytes)
              .digest('hex')
              .slice(0, 10);
            return `${attr}="${url}?v=${hash}"`;
          } catch {
            return whole; // file missing — leave the reference untouched
          }
        },
      );
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [vendorCacheBust()],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);
