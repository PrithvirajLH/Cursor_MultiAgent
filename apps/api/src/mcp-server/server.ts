/**
 * MCP Server for CSH Ticketing System
 *
 * Exposes AI pipeline tools via the Model Context Protocol so that
 * Azure AI Foundry agents can call them directly.
 *
 * Tool Categories:
 * - User Tools: get_user_profile, get_user_history
 * - Routing Tools: get_departments, get_categories, get_routing_rules
 * - Ticket Tools: create_ticket, create_sla_instance
 *
 * Usage:
 *   npx ts-node src/mcp-server/server.ts
 *
 * This bootstraps a minimal NestJS application context (no HTTP listener)
 * and exposes the tool registry via MCP SSE or Stdio transport.
 */

import { NestFactory } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import http from 'http';
import { timingSafeEqual } from 'crypto';

import { AppModule } from '../app.module';
import { ToolRegistryService } from '../ai/tools/tool-registry.service';
import type { ToolCallContext } from '../ai/tools/tool-call-context';

/**
 * ⚠️ THE ONE CALLER THAT MAY NAME ITS OWN SUBJECT (card 1.85).
 *
 * Everywhere else the subject comes from the authenticated request, because the
 * model must not be able to choose whose profile and history it reads. This
 * transport has no session: it is a separate process, bound to 127.0.0.1 and
 * gated by MCP_SERVER_TOKEN, whose whole purpose is to let a Foundry agent look
 * up the requester it was handed. The bearer token IS the authorisation here -
 * which is why the SSE transport refuses to start without one.
 *
 * `user` stays null, so `create_ticket` refuses over MCP exactly as it always
 * has. Do not paper over that with a service account without deciding, on
 * purpose, who the requester of such a ticket would be.
 */
const mcpContext = (subjectId = ''): ToolCallContext => ({
  user: null,
  subjectId,
});

function createMcpServer(toolRegistry: ToolRegistryService): McpServer {
  const server = new McpServer({
    name: 'csh-ticketing-system',
    version: '1.0.0',
  });

  // ─── User Tools ──────────────────────────────────────────────────────────

  server.tool(
    'get_user_profile',
    'Retrieves the profile of a user including their department, role, location, and primary team.',
    {
      userId: z.string().describe('The ID of the user to look up'),
    },
    async ({ userId }) => {
      const result = await toolRegistry.executeTool('get_user_profile', {}, mcpContext(userId));
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'get_user_history',
    'Retrieves the 10 most recent tickets submitted by a user.',
    {
      userId: z.string().describe('The ID of the user to look up'),
    },
    async ({ userId }) => {
      const result = await toolRegistry.executeTool('get_user_history', {}, mcpContext(userId));
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // ─── Routing Tools ───────────────────────────────────────────────────────

  server.tool(
    'get_departments',
    'Retrieves all active departments (teams) from the database.',
    {},
    async () => {
      const result = await toolRegistry.executeTool('get_departments', {}, mcpContext());
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'get_categories',
    'Retrieves the full category tree (hierarchical) with parent-child relationships.',
    {},
    async () => {
      const result = await toolRegistry.executeTool('get_categories', {}, mcpContext());
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'get_routing_rules',
    'Retrieves active keyword-based routing rules that map keywords to teams.',
    {},
    async () => {
      const result = await toolRegistry.executeTool('get_routing_rules', {}, mcpContext());
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  // ─── Ticket Tools ────────────────────────────────────────────────────────

  server.tool(
    'create_ticket',
    'Creates a new ticket in the database. Returns the created ticket with its ID and number.',
    {
      subject: z.string().max(255).describe('Ticket subject line'),
      description: z.string().describe('Ticket description'),
      priority: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).describe('Priority level'),
      channel: z.enum(['PORTAL', 'EMAIL']).describe('Channel'),
      assignedTeamId: z.string().describe('Team ID to assign to'),
      categoryId: z.string().nullable().describe('Category ID or null'),
      displayId: z.string().describe('Human-readable ticket ID'),
      tags: z.array(z.string()).describe('Tags'),
      requesterId: z.string().describe('Requester user ID'),
    },
    async (params) => {
      const result = await toolRegistry.executeTool('create_ticket', {
        draft: {
          subject: params.subject,
          description: params.description,
          priority: params.priority,
          channel: params.channel,
          assignedTeamId: params.assignedTeamId,
          categoryId: params.categoryId,
          displayId: params.displayId,
          tags: params.tags,
        },
        requesterId: params.requesterId,
      }, mcpContext());
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'create_sla_instance',
    'Creates an SLA tracking instance for a ticket based on priority.',
    {
      ticketId: z.string().describe('Ticket ID'),
      priority: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).describe('Priority level'),
    },
    async ({ ticketId, priority }) => {
      const result = await toolRegistry.executeTool('create_sla_instance', { ticketId, priority }, mcpContext());
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  return server;
}

/**
 * Constant-time comparison of a presented bearer token against the expected
 * one. Avoids leaking the token through response-timing differences.
 */
function isAuthorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) {
    return false;
  }
  const presented = Buffer.from(header.slice('Bearer '.length));
  const secret = Buffer.from(expected);
  if (presented.length !== secret.length) {
    return false;
  }
  return timingSafeEqual(presented, secret);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const toolRegistry = app.get(ToolRegistryService);
  const mcpServer = createMcpServer(toolRegistry);

  const transport = process.env.MCP_SERVER_TRANSPORT ?? 'stdio';

  if (transport === 'sse') {
    const port = parseInt(process.env.MCP_SERVER_PORT ?? '3001', 10);
    // Bind to loopback by default. These tools accept userId/requesterId as
    // parameters, so anyone who can reach the port can act as any user.
    const host = process.env.MCP_SERVER_HOST ?? '127.0.0.1';
    const token = process.env.MCP_SERVER_TOKEN?.trim();
    if (!token) {
      throw new Error(
        'MCP_SERVER_TOKEN is required when MCP_SERVER_TRANSPORT=sse. The SSE transport exposes tools that act on behalf of any user id, so it must not run unauthenticated.',
      );
    }

    // Simple SSE HTTP server
    const httpServer = http.createServer(async (req, res) => {
      if (!isAuthorized(req.headers.authorization, token)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/sse') {
        const sseTransport = new SSEServerTransport('/messages', res);
        await mcpServer.connect(sseTransport);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    httpServer.listen(port, host, () => {
      console.log(`MCP SSE Server running on ${host}:${port} (bearer auth required)`);
    });
  } else {
    // Stdio transport
    const stdioTransport = new StdioServerTransport();
    await mcpServer.connect(stdioTransport);
    console.log('MCP Stdio Server running');
  }
}

main().catch(console.error);
