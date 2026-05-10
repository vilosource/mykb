# Upstream Pi: notes on the `context` extension event

> **Audience:** maintainers of `@mariozechner/pi-coding-agent` and authors of Pi extensions that inject per-turn context.
>
> **Status:** draft for upstream filing — operator's call whether to open as a docs PR, an issue, or a discussion against the pi-coding-agent repo.
>
> **Source of findings:** `mykb` extension at `vilosource/mykb`, debugged 2026-05-10 while writing a Layer-4 scenario that asserted on entry-level marker FACTS (not just area metadata). The bugs had been latent since mykb's per-turn injection feature shipped — masked because every prior assertion either accepted the always-correct `<mykb-areas>` block (from `before_agent_start`'s `systemPrompt` return) or had a tool-call fallback (`kb_search`/`kb_load`) that delivered the marker via a different path.

## TL;DR for extension authors

If your extension subscribes to `pi.on('context', handler)`, the handler:

1. **Receives** a `ContextEvent` object: `{ type: 'context', messages: AgentMessage[] }` — read `event.messages`, not `event` directly.
2. **Returns** a `ContextEventResult`: `{ messages?: AgentMessage[] }` — return an object, not a bare array.
3. **Cannot inject `role: 'system'` messages.** `convertToLlm()` (in `pi-agent-core`) handles only `user` / `assistant` / `toolResult` / `bashExecution` / `custom` / `branchSummary` / `compactionSummary`. A `system`-role message falls through the default case and is silently filtered out before the LLM request. Use `role: 'custom'` (becomes a user-role text message in the LLM payload — the documented channel for extension-injected content).

Each of the three is a one-liner if you read the type definitions, but together they form a "silently does nothing" failure mode where the handler ostensibly works (no crash, no error log) yet zero injected content reaches the LLM. Two of the three are at the type-system boundary; the third (the role filter) is a runtime behavior with no compile-time signal.

## What we hit (story form)

mykb's `context` handler was written at:

```ts
return async (...args: unknown[]): Promise<unknown> => {
  const messages = args[0] as Message[];
  // ... scoring/selection ...
  return [systemMessage, ...messages];
};
```

This compiles. It runs without errors. It even produces visible side effects — the `state.loadedAreas` set grew, `state.turnCount` advanced, the handler's debug log fired. But the marker fact in the rendered context block never reached the LLM.

The diagnostic chain had three layers:

1. **`args[0] as Message[]` was wrong.** `args[0]` is the full `ContextEvent` object. Pi's runner.js passes `{ type: 'context', messages: currentMessages }`. Reading the event as if it were the array meant our handler treated `{ type, messages }` as a single weird "Message" entry. Effects:
   - The event passed in didn't crash because casting `unknown` to `Message[]` is a TS-only assertion; runtime saw an object.
   - Our prepend `[systemMessage, ...messages]` spread the event's enumerable properties (or got `undefined`s), producing a malformed array.

2. **Returning a bare `Message[]` didn't replace the conversation.** Pi's runner does:
   ```js
   const handlerResult = await handler(event, ctx);
   if (handlerResult && handlerResult.messages) {
     currentMessages = handlerResult.messages;
   }
   ```
   A returned `Message[]` is truthy but has no `.messages` property. So `currentMessages` was never updated. Whatever we returned was silently dropped.

3. **Even after fixing 1 and 2, `role: 'system'` was filtered.** Pi's `convertToLlm` (`pi-agent-core/dist/core/messages.js`):
   ```js
   switch (m.role) {
     case "user": case "assistant": case "toolResult":
       return m;
     case "custom": /* converts to user-role text */
     // ... etc
     default: return undefined; // <-- "system" lands here
   }
   ```
   The injected message was being correctly passed forward by the runner, but `convertToLlm` mapped it to `undefined` and the subsequent `.filter((m) => m !== undefined)` dropped it.

The fix is short:

```ts
return async (...args: unknown[]): Promise<ContextEventResult | undefined> => {
  const event = args[0] as ContextEvent;
  const messages = event?.messages ?? [];
  // ... scoring/selection ...
  const customMessage = { role: 'custom', content: contextBlock };
  return { messages: [customMessage, ...messages] };
};
```

But the *finding* was three days of debugging. Hence this note.

## Suggested upstream changes

In rough order of leverage:

### 1. Add a docs section: "Writing a context handler"

Cover the three points in TL;DR above with a minimal working example. The current README mentions `context` events but doesn't describe the contract end-to-end. The type definitions in `types.d.ts` are correct but easy to miss when working at the `(...args: unknown[]) => Promise<unknown>` boundary.

### 2. Make the type more discoverable from the API surface

`ExtensionAPI.on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>)` is already typed correctly. The friction is that extensions written against the looser `(...args: unknown[]) => Promise<unknown>` shape (which mykb uses to avoid hard-coupling to pi-coding-agent's types) lose the compile-time signal. Two options:

- Re-export `ContextEvent` and `ContextEventResult` (and the other event/result pairs) at the top level of pi-coding-agent's public types so extensions can import them without reaching into internal paths.
- Add a runtime validator helper: `pi.handlerForContext((event, ctx) => ...)` that wraps the handler and gives type-checked access to `event.messages`.

### 3. Document the `convertToLlm` role allowlist

Either:
- Add a `role: 'system'` case that maps to whatever Pi's preferred channel is (probably the agent's `systemPrompt` field or the `custom` lowering), AND/OR
- Document explicitly: "The only roles that survive `convertToLlm()` are: ...; system messages must be added via `before_agent_start`'s `systemPrompt` return, not via `context`'s `messages`."

The current behavior — silent drop — feels surprising. A `console.warn("convertToLlm: role 'system' is not supported in messages; use 'custom' or before_agent_start's systemPrompt")` would have shortened our debug by a long way.

### 4. (Lower priority) First-turn event ordering

On a fresh session, the FIRST `context` event fires before the `input` event has dispatched signal-extracting handlers. So a handler that adds signals on `input` and consumes them on `context` will see empty signals on the very first turn.

This is sensible behavior — `context` runs before each LLM call, including the very first one — but the asymmetry is non-obvious. A docs note would help: "On the first turn, `context` fires with whatever state your handlers have built up before that point. If you derive signals from `input`, you'll see them on the second turn onward."

For mykb this was not a Pi bug — once we built file-backed `SessionState` (persisting signals across separate Pi container invocations that share a `KB_SESSION_ID`), the first context call in a new container correctly sees signals seeded by the previous container's `input` events. So the architectural fix is in the extension, not in Pi. But the docs note would prevent extension authors from chasing a phantom bug.

## What we did NOT find

- No bug in Pi's runner. The runner does exactly what its type definitions say.
- No bug in `convertToLlm`'s allowed-role list as a design choice — Pi's reasons for restricting roles in messages (compaction, tree mutations, branch summaries) make sense. The issue is purely that the restriction isn't surfaced.
- No issue with the `before_agent_start` channel — it works correctly and is the right choice for static / per-session content. The `context` channel is the right choice for per-turn dynamic content; both are needed.

## Reference

- mykb commit that fixed the bugs: `08f732d` — `fix(extension): per-turn context injection actually delivers to LLM + scoring-isolated v3` on https://github.com/vilosource/mykb
- The scenario that surfaced it: `experiments/area-scoring/scenarios/scoring-isolated.sh`
- Methodology gotcha logged: kb gotcha `TPafXsZF` (mykb area)
