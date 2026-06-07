/**
 * Topology Dojo — headless authoring API.
 *
 * The DOM-free surface for creating, mutating, and validating topology
 * documents in code. The GUI and (in future) an MCP server both build on this;
 * the document JSON it produces is the shared contract.
 */
export * from './builder.js';
export * from './validate.js';
export * from './builtins.js';
export * from './markers.js';
export * from './catalog.js';
export * from './layout.js';
export * from './tidy.js';
export * from './geometry.js';
