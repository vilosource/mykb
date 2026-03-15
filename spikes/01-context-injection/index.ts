/**
 * Spike 01: Context Injection via Pi's `context` event
 *
 * Question: Can we inject knowledge into the message history before
 * each LLM call using Pi's `context` event? Does the AI see and use
 * the injected knowledge? Does it work across providers?
 *
 * What this does:
 * - Subscribes to the `context` event
 * - Prepends a fake knowledge block to the message array
 * - The AI should "know" these facts without being told
 *
 * How to test:
 * 1. Copy this file to ~/.pi/agent/extensions/spike-context/index.ts
 * 2. Start Pi: pi
 * 3. Ask: "What port does the API gateway run on?"
 *    Expected: AI answers "8443" (from injected context)
 * 4. Ask: "What database does the user service use?"
 *    Expected: AI answers "PostgreSQL 15" (from injected context)
 * 5. Ask something unrelated to verify normal behavior isn't broken
 *
 * Success criteria:
 * - AI uses injected facts to answer questions
 * - No noticeable latency increase
 * - Normal tool usage (read, bash, etc.) still works
 * - Works with at least 2 different providers
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const FAKE_KNOWLEDGE = `<mykb-context>
## api-gateway
- API gateway runs on port 8443 with TLS termination (verified:2026-03-15)
- Rate limiting set to 1000 req/min per API key (verified:2026-03-15)
- Gateway routes: /api/v1/users → user-service:3000, /api/v1/orders → order-service:3001 (verified:2026-03-15)

## user-service
- User service uses PostgreSQL 15 with connection pooling via PgBouncer (verified:2026-03-15)
- Authentication via JWT with 24h expiry, refresh tokens in Redis (verified:2026-03-15)
- User table has 2.3M rows, indexed on email and created_at (verified:2026-03-15)
</mykb-context>`;

export default function (pi: ExtensionAPI) {
  let turnCount = 0;

  pi.on("context", async (event) => {
    turnCount++;

    // Inject knowledge as a system message at the start of the message array
    const knowledgeMessage = {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `[mykb knowledge context - use these facts when relevant]\n\n${FAKE_KNOWLEDGE}`,
        },
      ],
    };

    return {
      messages: [knowledgeMessage, ...event.messages],
    };
  });

  pi.on("session_start", async () => {
    console.error(
      "[spike-01] Context injection extension loaded. Ask about api-gateway or user-service to test."
    );
  });
}
