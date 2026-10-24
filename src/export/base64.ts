/** Runtime-agnostic base64 for binary exports (browser, Node, Worker). */

/** Bytes → base64, chunked so large files don't overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
