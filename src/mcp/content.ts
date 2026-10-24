/**
 * Rich tool results — MCP content beyond a single text block. Most tools
 * return a string or JSON (see `tools.ts`); the export and view tools need
 * images, embedded files and MCP Apps metadata, so they return a
 * `ContentResult`, which `register.ts` passes through as-is.
 */

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource:
        | { uri: string; mimeType: string; blob: string }
        | { uri: string; mimeType: string; text: string };
    };

export class ContentResult {
  constructor(
    readonly content: McpContentBlock[],
    /** Typed data for clients and MCP Apps views. */
    readonly structuredContent?: Record<string, unknown>,
    /**
     * Result metadata. MCP Apps hosts hand it to the view but do not add it
     * to the model's context, so bulky view-only data (an SVG) rides here.
     */
    readonly meta?: Record<string, unknown>,
  ) {}

  /** The text blocks joined — a readable summary (tests, logging). */
  get text(): string {
    return this.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }

  /** The MCP CallToolResult shape. */
  toResult(): {
    content: McpContentBlock[];
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  } {
    return {
      content: this.content,
      ...(this.structuredContent
        ? { structuredContent: this.structuredContent }
        : {}),
      ...(this.meta ? { _meta: this.meta } : {}),
    };
  }
}
