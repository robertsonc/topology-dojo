/**
 * PNG helpers for print-true exports: stamp the physical resolution (a
 * `pHYs` chunk) so a 150-DPI render of an ANSI C sheet prints at 22 × 17 in
 * instead of whatever the viewer assumes. Pure byte manipulation.
 */

let table: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3), as PNG chunks use. */
export function crc32(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++)
    c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** True when the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Return a copy of `png` with a `pHYs` chunk declaring `dpi` (replacing none:
 * resvg writes no pHYs). Inserted right after IHDR, as the spec requires
 * (before IDAT).
 */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error('not a PNG');
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + len + type + data + crc
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk, 4, 17));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Read the DPI a PNG declares in `pHYs`, or null. */
export function pngDpi(png: Uint8Array): number | null {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  while (o + 8 <= png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'pHYs' && png[o + 16] === 1)
      return Math.round(dv.getUint32(o + 8) * 0.0254);
    if (type === 'IDAT') return null;
    o += 12 + len;
  }
  return null;
}
