// Model Context Protocol endpoint: how an AI bot (Claude, ChatGPT, n8n,
// OpenClaw and others) works with the CRM without a browser. Streamable HTTP,
// stateless: every POST carries JSON-RPC and gets a JSON answer; there is no
// server-to-client stream. The bot signs in with an API key from
// Settings → חיבור בוט, sent as "Authorization: Bearer <key>".
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { MCP_INSTRUCTIONS, runTool, toolListing, type ToolContext } from '@/lib/mcp-tools';
import { clientIp } from '@/lib/request-ip';
import { apiKeySession } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function unauthorized(message: string) {
  return NextResponse.json(rpcError(null, -32001, message), {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer realm="crm", error="invalid_token"' },
  });
}

async function handle(message: RpcMessage, ctx: ToolContext) {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize': {
      const asked = String(params?.protocolVersion || '');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'crm', title: 'CRM', version: '1.0.0' },
          instructions: MCP_INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: toolListing(ctx) } };
    case 'tools/call': {
      const name = String(params?.name || '');
      const args = (params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      return { jsonrpc: '2.0', id, result: await runTool(name, args, ctx) };
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } };
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: NextRequest) {
  const key = await apiKeySession();
  if (!key) return unauthorized('נדרש מפתח API: Authorization: Bearer <key> (יוצרים אותו בהגדרות ← חיבור בוט)');
  if (!key.ok) return unauthorized(key.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const ip = clientIp(request);
  const ctx: ToolContext = {
    authorization: request.headers.get('authorization') || '',
    ip: ip === 'unknown' ? undefined : ip,
    canWrite: key.canWrite,
    isAdmin: key.session.scope === 'admin',
    you: { name: key.session.name || '', role: key.session.role, keyName: key.keyName },
  };

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcMessage[];
  if (!messages.length || messages.some((m) => !m || typeof m !== 'object')) {
    return NextResponse.json(rpcError(null, -32600, 'Invalid Request'), { status: 400 });
  }

  const replies = [];
  for (const message of messages) {
    // Notifications (no id) and replies from the client get no answer.
    if (message.id === undefined || message.id === null || !message.method) continue;
    replies.push(await handle(message, ctx));
  }
  if (!replies.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? replies : replies[0]);
}

/** No server-to-client stream: everything comes back on the POST. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
