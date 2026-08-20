/**
 * Shared shapes for MCP-session activity (Initiative A).
 *
 * Imported by BOTH `worker/` (the per-session `TopologyMcp` trail + the
 * `AnalyticsLog` session index) and the admin dashboard UI, so — like
 * `src/admin/model.ts` — this lives under `src/` and carries types plus
 * constants only (no I/O).
 *
 * Privacy boundary: metadata only. Tool name, timestamp, and a coarse
 * success/error outcome. Never raw prompts, arguments, completions, or
 * diagram contents.
 */

/** Coarse tool-call result. Success vs. error only — no payloads. */
export type ToolCallOutcome = 'success' | 'error';

/** One recorded MCP tool invocation on a session Durable Object. */
export interface ToolCallEvent {
  /** Registered MCP tool name (e.g. `get_authoring_guidance`). */
  toolName: string;
  /** ISO timestamp of the call. */
  at: string;
  outcome: ToolCallOutcome;
}

/**
 * Cross-session discovery record stored on `AnalyticsLog` (migration `v5`,
 * already live). Bounded and oldest-evicted; one row per MCP session.
 */
export interface SessionSummary {
  /** Durable Object id hex (`ctx.id.toString()`), used to look the trail up. */
  sessionId: string;
  /** GitHub numeric uid of the authenticated MCP user. */
  ownerId: string;
  /** GitHub login at session start (display only; may go stale). */
  ownerLogin?: string;
  /** ISO timestamp of session start (`TopologyMcp.init()`). */
  startedAt: string;
  /** ISO timestamp of the most recent recorded tool call, if any. */
  lastToolAt?: string;
  /** Number of tool-call events recorded on this session (capped by the trail). */
  toolCallCount: number;
}

/** The `GET /api/admin/sessions` payload. */
export interface SessionList {
  sessions: SessionSummary[];
}

/** The `GET /api/admin/sessions/:id` payload. */
export interface SessionDetail {
  session: SessionSummary;
  events: ToolCallEvent[];
}

/** MCP tool whose prior success is the honest (non-causal) guidance signal. */
export const GUIDANCE_TOOL_NAME = 'get_authoring_guidance';
