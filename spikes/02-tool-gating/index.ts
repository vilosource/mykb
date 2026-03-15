/**
 * Spike 02: Tool Gating via Pi's `tool_call` event
 *
 * Question: When we block a tool_call and provide a reason + alternative,
 * does the AI follow the redirect? Or does it retry, loop, or give up?
 *
 * What this does:
 * - Registers a `kb_add` tool as the "correct" way to add knowledge
 * - Blocks any `write` or `edit` tool call that targets .jsonl files
 * - Returns a block reason pointing to kb_add
 *
 * How to test:
 * 1. Copy this file to ~/.pi/agent/extensions/spike-gating/index.ts
 * 2. Start Pi: pi
 * 3. Ask: "Create a file called test.jsonl with some data"
 *    Expected: AI gets blocked, switches to kb_add tool (or explains the restriction)
 * 4. Ask: "Add a fact: the API uses port 8080"
 *    Expected: AI uses kb_add tool directly
 * 5. Ask: "Create a regular file called notes.txt"
 *    Expected: AI uses write tool normally (not blocked — only .jsonl is gated)
 *
 * Success criteria:
 * - AI does NOT retry the blocked write
 * - AI either uses kb_add or explains why it can't write .jsonl
 * - Non-.jsonl file operations work normally
 * - Works with at least 2 different providers
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Register the "correct" tool for adding knowledge
  pi.registerTool({
    name: "kb_add",
    label: "KB Add",
    description:
      "Add a knowledge fact to the brain. Use this instead of directly writing .jsonl files.",
    promptSnippet: "Add knowledge facts to the brain",
    promptGuidelines: [
      "Use this tool to add facts, decisions, or gotchas to knowledge areas",
      "Do NOT write to .jsonl files directly — always use this tool",
    ],
    parameters: Type.Object({
      area: Type.String({ description: "Knowledge area ID (e.g., api-gateway)" }),
      type: Type.String({
        description: "Entry type",
        enum: ["fact", "decision", "gotcha", "pattern"],
      }),
      text: Type.String({ description: "The knowledge content" }),
      source: Type.Optional(
        Type.String({ description: "Where this knowledge came from" })
      ),
    }),
    async execute(_toolCallId, params) {
      // Spike: just log and confirm — no actual storage
      const msg = `[spike-02] Would add ${params.type} to area '${params.area}': "${params.text}" (source: ${params.source || "none"})`;
      console.error(msg);
      return {
        content: [
          {
            type: "text" as const,
            text: `Added ${params.type} to ${params.area}: "${params.text}"`,
          },
        ],
        details: {},
      };
    },
  });

  // Block writes to .jsonl files
  pi.on("tool_call", async (event) => {
    // Check if this is a write/edit to a .jsonl file
    const isWriteTool = event.toolName === "write" || event.toolName === "edit";
    if (!isWriteTool) return;

    const filePath = event.input?.file_path || event.input?.path || event.input?.filePath || "";
    if (typeof filePath === "string" && filePath.endsWith(".jsonl")) {
      return {
        block: true,
        reason:
          "Do not write to .jsonl files directly. These are managed by the knowledge system. Use the kb_add tool instead to add knowledge entries.",
      };
    }
  });

  pi.on("session_start", async () => {
    console.error(
      "[spike-02] Tool gating extension loaded. Try writing a .jsonl file — it should be blocked."
    );
  });
}
