# Spikes — Validation Experiments

Each spike validates a critical assumption before we build on it.

## How to test

Use `vfa` to launch Pi in a Docker container:

```bash
# Start a Pi session with a spike extension mounted
vfa session start --provider pi --prompt "test prompt here"

# Send follow-up prompts
vfa session send --prompt "follow-up"

# Close when done
vfa session close
```

For extensions, mount the spike directory into the container's Pi extensions path. See each spike's README for specific instructions.

## Spikes

| # | Question | Status | Result |
|---|----------|--------|--------|
| 01 | Does Pi's `context` event work for knowledge injection? | PASS | AI correctly answers from injected facts. ~4s latency, ~$0.0006/query |
| 02 | Does `tool_call` blocking redirect the AI correctly? | PASS | AI gets blocked, quotes the reason, and uses the alternative `kb_add` tool |
| 03 | Does `better-sqlite3` work inside Pi packages? | PASS | Native module loads, FTS5 works, queries return correct results |

## Results

### Spike 01: Context Injection — PASS

Tested via `vfa run --provider pi --profile mykb-spike`.

The `context` event successfully injects a `<mykb-context>` block into the message history. The AI uses the injected facts to answer questions it would otherwise have no knowledge of:
- "What port does the API gateway run on?" → "port 8443" (from injected context)
- "What database does the user service use?" → "PostgreSQL 15 with PgBouncer" (from injected context)

Latency: ~4s total (includes container startup). Cost: ~$0.0006/query.

**Key learning:** The `context` event property name for messages is `event.messages` — returns a deep copy safe to modify. Works with z.ai provider (GLM model).

### Spike 02: Tool Gating — PASS

The `tool_call` event blocks writes to `.jsonl` files and redirects to `kb_add`.

- Direct write to `data.jsonl` → **BLOCKED** with reason message
- AI then uses `kb_add` tool without being explicitly told to
- Non-`.jsonl` writes (e.g., `notes.txt`) work normally

**Key learning:** The event property is `event.toolName` (not `event.tool`). First attempt failed because of wrong property name. Pi's tool_call event uses camelCase for properties.

### Spike 03: SQLite in Pi — PASS

`better-sqlite3` native module loads correctly inside the Pi container. FTS5 extension is available. In-memory database with 8 seeded entries works correctly.

- `kb_search("PostgreSQL")` → returns matching fact from user-service area
- `kb_search("gateway")` → returns API gateway facts
- `kb_search("database")` → no results (word not in any fact text — expected for keyword search)

**Key learning:** Host-compiled `better-sqlite3` (Node.js 20) works in the Pi container (also Node.js 20). FTS5 is keyword-exact — "database" doesn't match "PostgreSQL" (BM25 is still keyword-based, not semantic). This confirms the known/unknown about FTS5 accuracy.

## Testing Setup

Profile: `~/.vf-agents/profiles/mykb-spike.yaml`
Provider: `pi` (z.ai with GLM model)
Method: `vfa run --provider pi --profile mykb-spike --prompt "..."`

The profile mounts `spikes/active-spike/` → `/home/node/.pi/agent/extensions/mykb-spike/` inside the container. Symlink `active-spike` to the spike being tested.
