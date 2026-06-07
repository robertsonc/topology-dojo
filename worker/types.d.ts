// The vendored engine is plain CommonJS JS with no type declarations; the
// bundler (Wrangler/esbuild) inlines it. Declare the module so the Worker
// typechecks the default import.
declare module '*topology-ds.js' {
  const Engine: unknown;
  export default Engine;
}
