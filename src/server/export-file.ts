/**
 * Local file output for `export_topology` on the stdio server: the agent and
 * the user share a machine, so a large .vsdx / .pptx / .pdf is better written
 * to disk than streamed through the conversation as base64.
 *
 * Writes are confined to one export root — `TOPOLOGY_DOJO_EXPORT_DIR` when
 * set, else the server's working directory. A path that resolves outside the
 * root (`..`, another absolute path, a symlinked parent) is refused.
 */
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The directory exports are confined to. */
export function exportRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.TOPOLOGY_DOJO_EXPORT_DIR || process.cwd());
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Write `bytes` to `requested` (relative to, and confined in, `root`). */
export async function writeExportFile(
  root: string,
  requested: string,
  bytes: Uint8Array,
): Promise<string> {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(requested))
    throw new Error('outputPath contains control characters');
  const target = path.resolve(root, requested);
  if (!inside(root, target))
    throw new Error(
      `outputPath must stay inside the export directory ${root} (set TOPOLOGY_DOJO_EXPORT_DIR to change it)`,
    );
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true });
  // Re-check after resolving symlinks: a linked parent must not escape.
  const realRoot = await realpath(root);
  const realDir = await realpath(dir);
  if (realDir !== realRoot && !inside(realRoot, realDir))
    throw new Error('outputPath resolves outside the export directory');
  await writeFile(target, bytes);
  return target;
}
