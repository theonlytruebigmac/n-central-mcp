#!/usr/bin/env node

/**
 * N-central MCP Server
 *
 * Exposes N-central REST API GET endpoints as MCP tools, with resources
 * for org hierarchy context and prompts for common workflows.
 *
 * Env vars:
 *   NC_SERVER_URL    - N-central server URL
 *   NC_JWT_TOKEN     - User-API JWT token from N-central
 *   NC_WRITE_MODE    - read-only | write | full (default: write)
 *   MCP_PORT         - Set to enable Streamable HTTP mode (otherwise stdio)
 *   MCP_API_KEY      - Required for HTTP mode auth
 *   MCP_CORS_ORIGIN  - Allowed CORS origin (default: disabled)
 *   MCP_BIND_ADDRESS - Bind address (default: 127.0.0.1)
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import http from 'http';

import { authenticate } from './src/auth.js';
import { setServerUrl } from './src/client.js';
import { registerResources } from './src/resources.js';
import { registerPrompts } from './src/prompts.js';
import { auditLog } from './src/logging.js';

import { deviceTools } from './src/tools/devices.js';
import { organizationTools } from './src/tools/organizations.js';
import { scheduledTaskTools } from './src/tools/scheduled-tasks.js';
import { customPropertyTools } from './src/tools/custom-properties.js';
import { userTools } from './src/tools/users.js';
import { miscTools } from './src/tools/misc.js';
import { reportTools } from './src/tools/reports.js';

const NC_SERVER_URL = process.env.NC_SERVER_URL;
const NC_JWT_TOKEN = process.env.NC_JWT_TOKEN;

if (!NC_SERVER_URL || !NC_JWT_TOKEN) {
  console.error('Error: NC_SERVER_URL and NC_JWT_TOKEN environment variables are required.');
  console.error('  NC_SERVER_URL: Your N-central server URL (e.g. https://ncentral.example.com)');
  console.error('  NC_JWT_TOKEN:  Your User-API JWT token from N-central UI');
  process.exit(1);
}

const MCP_API_KEY = process.env.MCP_API_KEY || null;
const MCP_CORS_ORIGIN = process.env.MCP_CORS_ORIGIN || null;
const MCP_BIND_ADDRESS = process.env.MCP_BIND_ADDRESS || '127.0.0.1';
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

// Write mode gates which tools get registered.
//   read-only   — only GET/read tools (writeScope: 'read')
//   write       — adds create/update tools (writeScope: 'write')
//   full        — adds destructive tools: delete/direct-execution (writeScope: 'destructive')
const NC_WRITE_MODE = (process.env.NC_WRITE_MODE || 'write').toLowerCase();
const VALID_WRITE_MODES = new Set(['read-only', 'write', 'full']);
if (!VALID_WRITE_MODES.has(NC_WRITE_MODE)) {
  console.error(`Error: NC_WRITE_MODE must be one of: read-only, write, full (got: ${NC_WRITE_MODE})`);
  process.exit(1);
}

const SENSITIVE_TOOLS = new Set([
  'get_site_registration_token',
  'get_org_unit_registration_token',
  'get_customer_registration_token',
  'get_registration_token',
  'list_users',
  'list_all_users',
  'list_user_roles',
  'get_user_role',
  'list_access_groups',
  'list_all_access_groups',
  'get_access_group',
]);

function isToolAllowed(tool) {
  const scope = tool.writeScope || 'read';
  if (scope === 'read') return true;
  if (scope === 'write') return NC_WRITE_MODE === 'write' || NC_WRITE_MODE === 'full';
  if (scope === 'destructive') return NC_WRITE_MODE === 'full';
  return false;
}

// --- Rate limiting ---

const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    rateLimitMap.set(ip, entry);
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitCleanup.unref();

// --- Tool registration ---

const allTools = [
  ...deviceTools,
  ...organizationTools,
  ...scheduledTaskTools,
  ...customPropertyTools,
  ...userTools,
  ...miscTools,
  ...reportTools,
].filter(isToolAllowed);

// Any non-read tool is sensitive — audit-log every call.
for (const tool of allTools) {
  if (tool.writeScope && tool.writeScope !== 'read') SENSITIVE_TOOLS.add(tool.name);
}

function jsonSchemaToZod(prop) {
  let schema;
  switch (prop.type) {
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array': {
      const itemType = prop.items?.type;
      if (itemType === 'number' || itemType === 'integer') schema = z.array(z.number());
      else if (itemType === 'boolean') schema = z.array(z.boolean());
      else if (itemType === 'object') schema = z.array(z.object({}).passthrough());
      else schema = z.array(z.string());
      break;
    }
    case 'object':
      schema = z.object({}).passthrough();
      break;
    case 'string':
      schema = (prop.enum?.length) ? z.enum(prop.enum) : z.string();
      break;
    default:
      schema = z.string();
  }
  if (prop.description) schema = schema.describe(prop.description);
  return schema;
}

// Lazy auth — only authenticates on first tool call
let authenticated = false;
let pendingAuthInit = null;

async function ensureAuthenticated() {
  if (authenticated) return;
  if (pendingAuthInit) return pendingAuthInit;

  // Hold a local ref so callers that raced past the guard above can still
  // await the same promise after the finally block clears pendingAuthInit.
  const p = (async () => {
    setServerUrl(NC_SERVER_URL);
    await authenticate(NC_SERVER_URL, NC_JWT_TOKEN);
    authenticated = true;
    console.error(`Authenticated with N-central at ${NC_SERVER_URL}`);
  })();

  pendingAuthInit = p;
  try {
    await p;
  } finally {
    pendingAuthInit = null;
  }
}

function createServer() {
  const srv = new McpServer({
    name: 'ncentral-api',
    version: '2.1.0',
    description: 'N-central REST API MCP Server',
  });

  for (const tool of allTools) {
    const schemaShape = {};
    const properties = tool.inputSchema.properties || {};
    const required = tool.inputSchema.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      let zodProp = jsonSchemaToZod(prop);
      if (!required.includes(key)) zodProp = zodProp.optional();
      schemaShape[key] = zodProp;
    }

    const handler = tool.handler;
    const toolName = tool.name;

    srv.tool(toolName, tool.description, schemaShape, async (args) => {
      try {
        await ensureAuthenticated();

        if (SENSITIVE_TOOLS.has(toolName)) {
          auditLog('sensitive_tool_call', { tool: toolName, args });
        }

        const result = await handler(args);
        auditLog('tool_call', { tool: toolName, success: true });

        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        auditLog('tool_error', { tool: toolName, error: error.message });
        return {
          content: [{ type: 'text', text: `Error: ${sanitizeErrorMessage(error.message)}` }],
          isError: true,
        };
      }
    });
  }

  registerResources(srv, ensureAuthenticated);
  registerPrompts(srv);
  return srv;
}

function sanitizeErrorMessage(message) {
  let msg = message.replace(/https?:\/\/[^\s]+/g, '[server]');
  msg = msg.replace(/on GET \/api\/([^\s:]+)/g, 'on $1');
  return msg.length > 300 ? msg.substring(0, 300) + '...' : msg;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let done = false;

    const finish = (fn, val) => {
      if (done) return;
      done = true;
      fn(val);
    };

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        finish(reject, new Error('Request body too large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { finish(resolve, data ? JSON.parse(data) : undefined); }
      catch { finish(reject, new Error('Invalid JSON body')); }
    });
    req.on('error', err => finish(reject, err));
  });
}

function authenticateRequest(req) {
  if (!MCP_API_KEY) return true;

  const header = req.headers['authorization'];
  if (!header) return false;

  const parts = header.split(' ');
  const token = (parts.length === 2 && parts[0].toLowerCase() === 'bearer')
    ? parts[1]
    : header;

  return safeCompare(token, MCP_API_KEY);
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Burn constant time even on length mismatch
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function getClientIp(req) {
  // Only trust X-Forwarded-For behind a known reverse proxy.
  // In direct-exposure mode this header is untrusted (client-spoofable),
  // but rate limiting is per-socket IP anyway — the header is best-effort.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// --- Global error handlers ---

const MCP_PORT = process.env.MCP_PORT;

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`Unhandled rejection: ${msg}`);
  auditLog('unhandled_rejection', { error: msg });
});

process.on('uncaughtException', (error) => {
  console.error(`Uncaught exception: ${error.message}`);
  auditLog('uncaught_exception', { error: error.message });
  process.exit(1);
});

// --- Main ---

async function main() {
  try {
    const resourceCount = 4;
    const promptCount = 4;
    console.error(`Registered ${allTools.length} tools, ${resourceCount} resources, ${promptCount} prompts (NC_WRITE_MODE=${NC_WRITE_MODE})`);
    console.error('Auth will be performed on first tool call.');

    if (MCP_PORT) {
      if (!MCP_API_KEY) {
        console.error('⚠️  WARNING: MCP_API_KEY not set — HTTP endpoint is unauthenticated!');
      }
      if (!MCP_CORS_ORIGIN) {
        console.error('ℹ️  CORS disabled (no MCP_CORS_ORIGIN set).');
      }

      const transports = {};
      const sessionLastActivity = {};
      const SESSION_TTL_MS = 30 * 60_000;
      const cleaningUp = new Set();

      const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${MCP_PORT}`);
        const clientIp = getClientIp(req);

        // CORS
        if (MCP_CORS_ORIGIN) {
          res.setHeader('Access-Control-Allow-Origin', MCP_CORS_ORIGIN);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id');
          res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(MCP_CORS_ORIGIN ? 204 : 403);
          res.end();
          return;
        }

        if (!checkRateLimit(clientIp)) {
          auditLog('rate_limited', { ip: clientIp, path: url.pathname });
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests' }, id: null }));
          return;
        }

        if (!authenticateRequest(req)) {
          auditLog('auth_failed', { ip: clientIp, path: url.pathname });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' }, id: null }));
          return;
        }

        if (url.pathname !== '/mcp') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        if (req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const sessionId = req.headers['mcp-session-id'];

            if (sessionId && transports[sessionId]) {
              if (cleaningUp.has(sessionId)) {
                res.writeHead(410, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Session expired' }, id: null }));
                return;
              }
              sessionLastActivity[sessionId] = Date.now();
              await transports[sessionId].handleRequest(req, res, body);
            } else if (!sessionId && isInitializeRequest(body)) {
              auditLog('session_init', { ip: clientIp });
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                  transports[sid] = transport;
                  sessionLastActivity[sid] = Date.now();
                },
              });
              transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid) {
                  delete transports[sid];
                  delete sessionLastActivity[sid];
                }
              };
              const server = createServer();
              await server.connect(transport);
              await transport.handleRequest(req, res, body);
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: missing session' }, id: null }));
            }
          } catch (error) {
            console.error('POST /mcp error:', error.message);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
            }
          }
          return;
        }

        if (req.method === 'GET') {
          const sessionId = req.headers['mcp-session-id'];
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid session');
            return;
          }
          sessionLastActivity[sessionId] = Date.now();
          await transports[sessionId].handleRequest(req, res);
          return;
        }

        if (req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'];
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid session');
            return;
          }
          auditLog('session_delete', { sessionId, ip: clientIp });
          await transports[sessionId].handleRequest(req, res);
          return;
        }

        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
      });

      httpServer.on('clientError', (_err, socket) => {
        if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      });

      httpServer.listen(Number(MCP_PORT), MCP_BIND_ADDRESS, () => {
        console.error(`N-central MCP Server on http://${MCP_BIND_ADDRESS}:${MCP_PORT}/mcp`);
        if (MCP_API_KEY) console.error('  Auth: Bearer token required');
      });

      async function shutdown() {
        console.error('Shutting down...');
        auditLog('server_shutdown', {});
        for (const sid of Object.keys(transports)) {
          try { await transports[sid].close(); } catch {}
          delete transports[sid];
        }
        process.exit(0);
      }
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Clean up stale sessions
      const sessionCleanup = setInterval(() => {
        const now = Date.now();
        for (const sid of Object.keys(transports)) {
          if (!sessionLastActivity[sid]) {
            sessionLastActivity[sid] = now;
          } else if (now - sessionLastActivity[sid] > SESSION_TTL_MS) {
            if (cleaningUp.has(sid)) continue;
            cleaningUp.add(sid);
            auditLog('session_expired', { sessionId: sid });
            console.error(`Cleaning stale session: ${sid}`);
            try { transports[sid].close(); } catch {}
            delete transports[sid];
            delete sessionLastActivity[sid];
            cleaningUp.delete(sid);
          }
        }
      }, 5 * 60_000);
      sessionCleanup.unref();
    } else {
      // stdio mode
      const server = createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('N-central MCP Server running on stdio');
    }

    auditLog('server_start', { mode: MCP_PORT ? 'http' : 'stdio', toolCount: allTools.length });
  } catch (error) {
    console.error(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

main();
