import { readFileSync } from 'fs';
import { join } from 'path';

const SERVER = readFileSync(join(__dirname, 'server.ts'), 'utf8');

/**
 * Card 1.101 — the MCP server, which nobody starts and which has never fully
 * worked.
 *
 * ⚠️ IT DOES SHIP. It was reported as unreachable in production because
 * `ts-node` is a devDependency, and that is only half true: `create-deploy-zip.ps1`
 * copies the whole of `apps/api/dist`, so `dist/src/mcp-server/server.js` is
 * deployed and plain `node` can run it. Nothing STARTS it — the App Service
 * start command is `node dist/src/main.js` — but "nobody starts it" is a weaker
 * guarantee than "it will not start".
 *
 * That matters because these tools take a client-supplied `userId` with NO
 * session, which is exactly the door card 1.85 closed everywhere else.
 */
describe('the MCP server cannot start by accident (card 1.101)', () => {
  it('⚠️ refuses to run unless MCP_SERVER_ENABLED is set on purpose', () => {
    // THE REGRESSION ASSERTION. Without this the process starts from a bare
    // `node dist/src/mcp-server/server.js` on a production host.
    expect(SERVER).toContain("process.env.MCP_SERVER_ENABLED !== 'true'");
    // And it must refuse BEFORE building the application context, or it has
    // already connected to the database to tell you it will not run.
    const gate = SERVER.indexOf('MCP_SERVER_ENABLED');
    const boot = SERVER.indexOf('NestFactory.createApplicationContext');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(boot);
  });

  it('⚠️ no longer advertises create_ticket, which never worked', () => {
    // It needs a signed-in user to attribute the ticket to; this transport has
    // no session, so every call returned "No user context set for ticket
    // creation". A tool that has never worked is a lie in the tool list - an
    // agent reads the list, plans around it, and fails at the last step.
    expect(SERVER).not.toContain("'create_ticket'");
    expect(SERVER).not.toMatch(/Ticket Tools: create_ticket/);
  });

  it('still offers the tools that do work', () => {
    // The non-vacuity half: gating and trimming must not have emptied it.
    for (const tool of [
      'get_user_profile',
      'get_user_history',
      'get_departments',
      'get_categories',
      'get_routing_rules',
      'create_sla_instance',
    ]) {
      expect(SERVER).toContain(`'${tool}'`);
    }
  });

  it('⚠️ still refuses SSE without a token, and still binds loopback', () => {
    // Card 1.85 left these as the only protection on a session-less surface.
    // Whatever the owner decides about this process, these must not regress.
    expect(SERVER).toContain('MCP_SERVER_TOKEN is required');
    expect(SERVER).toContain("process.env.MCP_SERVER_HOST ?? '127.0.0.1'");
  });
});
