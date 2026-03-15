/**
 * Spike 03: SQLite (better-sqlite3) inside a Pi extension
 *
 * Question: Does better-sqlite3 (native C++ addon) work correctly
 * inside Pi's Node.js process? Can we create a database, use FTS5,
 * and query it from a registered tool?
 *
 * What this does:
 * - Creates an in-memory SQLite database with FTS5
 * - Seeds it with sample knowledge entries
 * - Registers a `kb_search` tool that queries via FTS5
 *
 * How to test:
 * 1. This spike needs `better-sqlite3` installed:
 *    mkdir -p ~/.pi/agent/extensions/spike-sqlite && cd $_
 *    echo '{"type":"module","dependencies":{"better-sqlite3":"^11.0.0"}}' > package.json
 *    npm install
 *    cp /path/to/this/index.ts .
 * 2. Start Pi: pi
 * 3. Ask: "Search the knowledge base for database"
 *    Expected: AI uses kb_search, gets results about PostgreSQL
 * 4. Ask: "Search for networking"
 *    Expected: Results about load balancer and DNS
 *
 * If better-sqlite3 fails to load:
 * - Try sql.js instead (pure WASM, no native code)
 * - This tells us we need to use sql.js for the real implementation
 *
 * Success criteria:
 * - better-sqlite3 loads without errors
 * - FTS5 extension is available
 * - Queries return correct results
 * - No crashes or memory issues during a session
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

let db: any;
let searchStmt: any;

function initDb() {
  // Dynamic import to handle potential load failure gracefully
  const Database = require("better-sqlite3");
  db = new Database(":memory:");

  // Enable WAL mode
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      area TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      tags TEXT,
      zone TEXT DEFAULT 'active',
      prov_status TEXT,
      prov_date TEXT
    );

    CREATE VIRTUAL TABLE entries_fts USING fts5(
      id, text, tags, area
    );
  `);

  // Seed with sample data
  const insert = db.prepare(
    "INSERT INTO entries (id, area, type, text, tags, zone, prov_status, prov_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertFts = db.prepare(
    "INSERT INTO entries_fts (id, text, tags, area) VALUES (?, ?, ?, ?)"
  );

  const seed = [
    ["a1", "api-gateway", "fact", "API gateway runs on port 8443 with TLS termination", '["api","gateway","tls"]', "active", "verified", "2026-03-15"],
    ["a2", "api-gateway", "fact", "Rate limiting set to 1000 req/min per API key", '["api","rate-limit"]', "active", "verified", "2026-03-15"],
    ["a3", "user-service", "fact", "User service uses PostgreSQL 15 with PgBouncer connection pooling", '["database","postgresql"]', "active", "verified", "2026-03-15"],
    ["a4", "user-service", "fact", "Authentication via JWT with 24h expiry, refresh tokens in Redis", '["auth","jwt","redis"]', "active", "verified", "2026-03-15"],
    ["a5", "networking", "fact", "Load balancer health checks on /healthz every 10 seconds", '["lb","health"]', "active", "verified", "2026-03-15"],
    ["a6", "networking", "fact", "Internal DNS uses CoreDNS with zone forwarding to upstream 10.0.0.2", '["dns","coredns"]', "established", "verified", "2026-03-10"],
    ["a7", "networking", "gotcha", "NAT gateway has asymmetric routing — inbound and outbound use different IPs", '["nat","routing"]', "active", "verified", "2026-03-12"],
    ["a8", "ci-pipelines", "decision", "Use spot instances for CI runners to reduce cost by 60%", '["runners","cost"]', "active", "verified", "2026-03-14"],
  ];

  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) {
      insert.run(...row);
      insertFts.run(row[0], row[3], row[4], row[1]);
    }
  });
  insertMany(seed);

  // Prepare search statement
  searchStmt = db.prepare(`
    SELECT e.id, e.area, e.type, e.text, e.tags, e.zone, e.prov_status, e.prov_date
    FROM entries_fts f
    JOIN entries e ON f.id = e.id
    WHERE f.text MATCH ?
    ORDER BY rank
    LIMIT 10
  `);

  return seed.length;
}

export default function (pi: ExtensionAPI) {
  let initError: string | null = null;
  let entryCount = 0;

  // Try to initialize SQLite
  try {
    entryCount = initDb();
  } catch (err: any) {
    initError = err.message;
    console.error(`[spike-03] FAILED to load better-sqlite3: ${err.message}`);
    console.error("[spike-03] Fallback needed: use sql.js (WASM) instead");
  }

  // Register search tool
  pi.registerTool({
    name: "kb_search",
    label: "KB Search",
    description: "Search the knowledge base using full-text search. Returns matching facts, decisions, and gotchas.",
    promptSnippet: "Search knowledge base with full-text queries",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (keywords)" }),
    }),
    async execute(_toolCallId, params) {
      if (initError) {
        return {
          content: [{ type: "text" as const, text: `SQLite initialization failed: ${initError}. better-sqlite3 native module could not load in Pi's Node.js process.` }],
          details: {},
        };
      }

      try {
        const results = searchStmt.all(params.query);
        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No results found for "${params.query}"` }],
            details: {},
          };
        }

        const formatted = results
          .map((r: any) => `- [${r.area}/${r.type}] ${r.text} (${r.prov_status}:${r.prov_date})`)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: `Found ${results.length} results:\n${formatted}` }],
          details: { count: results.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${err.message}` }],
          details: {},
        };
      }
    },
  });

  pi.on("session_start", async () => {
    if (initError) {
      console.error(`[spike-03] SQLite FAILED: ${initError}`);
    } else {
      console.error(`[spike-03] SQLite + FTS5 loaded. ${entryCount} entries seeded. Try: "search the knowledge base for database"`);
    }
  });
}
