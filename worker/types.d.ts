// The vendored engine is plain CommonJS JS with no type declarations; the
// bundler (Wrangler/esbuild) inlines it. Declare the module so the Worker
// typechecks the default import.
declare module '*topology-ds.js' {
  const Engine: unknown;
  export default Engine;
}

// Wrangler bundles `.wasm` imports as compiled WebAssembly modules (its
// default CompiledWasm rule) — resvg's renderer for server-side PNG / PDF.
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
