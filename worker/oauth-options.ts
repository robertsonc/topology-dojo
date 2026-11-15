/**
 * The OAuthProvider options (endpoints and protocol switches), shared by `worker/index.ts` and the
 * Miniflare fixture that runs the real provider in tests
 * (`src/testing/worker-fixtures.ts` `MCP_OAUTH_FIXTURE`), so the tested
 * configuration cannot drift from the deployed one.
 */
export const OAUTH_PROVIDER_OPTIONS = {
  apiRoute: '/mcp',
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // OAuth 2.1 / the MCP authorization spec: S256 only. The MCP SDK client
  // (@modelcontextprotocol/sdk, used by Claude's connectors and mcp-remote)
  // always sends S256.
  allowPlainPKCE: false,
} as const;
