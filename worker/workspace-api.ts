/** Owner-authenticated browser API for the shared human-agent workspace. */
import type { WorkerEnv } from './env.js';
import { currentUser } from './auth.js';
import { WorkspaceService } from './workspaces.js';
import type {
  CommitRequest,
  WorkspaceOperation,
} from '../src/workspace/model.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: JSON_HEADERS,
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'method not allowed' }, 405);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new Error('request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('request body must be a JSON object');
  return value as Record<string, unknown>;
}

function commitRequest(value: Record<string, unknown>): CommitRequest {
  return {
    baseRevision: Number(value.baseRevision),
    operationId: String(value.operationId ?? ''),
    operations: value.operations as WorkspaceOperation[],
  };
}

export async function handleWorkspaceApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);
  const service = new WorkspaceService(env, user);
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // /api/workspaces
    if (parts.length === 2) {
      if (request.method === 'GET') return json(await service.list());
      if (request.method === 'POST') {
        const input = await body(request);
        return json(await service.create(input.document), 201);
      }
      return methodNotAllowed();
    }

    const id = decodeURIComponent(parts[2] ?? '');
    if (!id) return json({ error: 'workspace id is required' }, 400);
    const tail = parts.slice(3);

    if (!tail.length) {
      if (request.method !== 'GET') return methodNotAllowed();
      return json(await service.snapshot(id));
    }

    if (tail[0] === 'manifest') {
      if (request.method !== 'GET') return methodNotAllowed();
      return json(await service.manifest(id));
    }

    if (tail[0] === 'changes') {
      if (request.method !== 'GET') return methodNotAllowed();
      const since = Number(url.searchParams.get('since') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const detail = url.searchParams.get('detail') === 'operations';
      return json(await service.changes(id, since, limit, detail));
    }

    if (tail[0] === 'operations') {
      if (request.method !== 'POST') return methodNotAllowed();
      const result = await service.applyUser(
        id,
        commitRequest(await body(request)),
      );
      return json(result, result.ok ? 200 : 409);
    }

    if (tail[0] === 'proposals') {
      if (tail.length === 1) {
        if (request.method !== 'GET') return methodNotAllowed();
        const includeResolved = url.searchParams.get('resolved') !== 'false';
        return json(await service.proposals(id, includeResolved));
      }
      const proposalId = decodeURIComponent(tail[1] ?? '');
      if (!proposalId) return json({ error: 'proposal id is required' }, 400);
      if (tail.length === 2) {
        if (request.method !== 'GET') return methodNotAllowed();
        return json(await service.proposal(id, proposalId));
      }
      if (tail[2] === 'accept') {
        if (request.method !== 'POST') return methodNotAllowed();
        const input = await body(request);
        const operationId = String(
          input.operationId ?? `ui_accept_${crypto.randomUUID()}`,
        );
        const result = await service.accept(id, proposalId, operationId);
        return json(result, result.ok ? 200 : 409);
      }
      if (tail[2] === 'reject') {
        if (request.method !== 'POST') return methodNotAllowed();
        return json(await service.reject(id, proposalId));
      }
    }

    if (tail[0] === 'lease') {
      if (request.method === 'PUT') {
        const input = await body(request);
        return json(
          await service.grantLease(
            id,
            String(input.pageId ?? ''),
            input.ttlSeconds === undefined
              ? undefined
              : Number(input.ttlSeconds),
          ),
        );
      }
      if (request.method === 'DELETE')
        return json({ revoked: await service.revokeLease(id) });
      return methodNotAllowed();
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('unknown workspace') ? 404 : 400;
    return json({ error: message }, status);
  }
}
