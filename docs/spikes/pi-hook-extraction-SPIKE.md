# Spike: Pi Extension Hook Extraction

## Question

Can we extract hook logic from `src/extension/hooks/*.ts` to `src/hooks/*.ts` without breaking Pi's extension loading?

## Why it matters

The knowledge harness design requires shared hook logic in `src/hooks/` that both the Pi extension and `kb-hook` CLI consume. Currently, all hook logic lives inside `src/extension/hooks/` which gets bundled into a single .js file by esbuild for Pi.

Pi extensions have strict loading requirements (see gotchas MYKB area). If the extraction changes import paths or bundle structure in a way Pi doesn't expect, the extension silently fails to load.

## Known constraints

From previous work:

1. Pi expects a single `.js` file (not `.ts`) pointed to by `package.json` `pi.extensions` field
2. The bundle is built by: `esbuild src/extension/index.ts --bundle --platform=node --format=esm --external:better-sqlite3`
3. esbuild resolves and inlines all imports into the single bundle (except externals)
4. `better-sqlite3` must be external (native module compiled inside container)
5. Pi uses jiti runtime which handles .ts and .js but has quirks
6. The extension entry point must export a default function

## What to verify

### Step 1: Extraction doesn't break the bundle

```bash
# Before extraction: build and check bundle
cd ~/GitHub/mykb
npx esbuild src/extension/index.ts --bundle --platform=node --format=esm \
  --external:better-sqlite3 --outfile=/tmp/before-bundle.js
wc -c /tmp/before-bundle.js

# After extraction: move files, update imports, rebuild
# (do this on a throwaway branch)
npx esbuild src/extension/index.ts --bundle --platform=node --format=esm \
  --external:better-sqlite3 --outfile=/tmp/after-bundle.js
wc -c /tmp/after-bundle.js

# Compare: both bundles should contain the same functions
# The after-bundle might be slightly different (import path changes)
# but should contain all the same logic
diff <(grep -oP 'function \w+' /tmp/before-bundle.js | sort) \
     <(grep -oP 'function \w+' /tmp/after-bundle.js | sort)
```

### Step 2: Extracted imports resolve correctly

The concern: if `src/extension/index.ts` imports from `../../hooks/session-start.ts` instead of `./hooks/session.ts`, does esbuild follow the path correctly?

```typescript
// Before:
import { createBeforeAgentStartHandler } from './hooks/session.js';

// After:
import { sessionStart } from '../../hooks/session-start.js';
```

esbuild should resolve relative imports regardless of depth. Verify by checking the bundle output contains the function.

### Step 3: Pi loads the bundle inside a container

```bash
# Build the bundle with extracted hooks
npm run build  # or esbuild command

# Test via vfa with Pi provider
vfa run --provider pi --profile mykb-dev \
  --prompt "Run kb list and show the result"
```

The Pi extension should:
- Load without errors
- Register all 5 tools (kb_add, kb_search, kb_load, kb_list, kb_work_journal)
- Inject area index on first turn (Tier 1)
- Respond to /kb command (Tier 3)

### Step 4: Shared functions work from both entry points

```typescript
// Both should call the same function with the same result:

// From Pi extension (in-process):
import { sessionStart } from '../../hooks/session-start.js';
const result = sessionStart(store, state, brainPath, wsStorage, event);

// From kb-hook CLI (separate process):
import { sessionStart } from '../hooks/session-start.js';
const result = sessionStart(store, state, brainPath, wsStorage, event);
```

Verify by running unit tests that import from `src/hooks/` directly.

## Risk areas

1. **Circular imports** — If `src/hooks/` imports types from `src/extension/` (like `SessionState`), and `src/extension/` imports from `src/hooks/`, esbuild may fail or produce wrong output. The types should be in `src/core/types.ts` (shared), not in extension-specific code.

2. **SessionState dependency** — The Pi extension passes `SessionState` (in-process object) to hook functions. The `kb-hook` CLI doesn't have this. Hook functions need to accept an optional state parameter, or the session state interface needs to be abstract enough that both a real object (Pi) and a file-backed store (CLI) can satisfy it.

3. **Store dependency** — Hook functions that call `store.loadArea()` or `store.search()` need a `MykbStore` instance. Pi creates this once at extension load. `kb-hook` would need to create it on every invocation (open SQLite, etc.). This adds ~20-30ms per invocation for SQLite open.

4. **better-sqlite3 in kb-hook** — If `kb-hook` calls functions that use `MykbStore` (which uses better-sqlite3), the bun compile needs to handle native modules. This may not work with `bun build --compile`. Alternative: `kb-hook` reads JSONL directly for simple operations, only opens SQLite for search/match.

## Test plan

On a throwaway branch:

1. Move `src/extension/hooks/session.ts` → `src/hooks/session-start.ts`
2. Update imports in `src/extension/index.ts`
3. Run `npm run build` (esbuild bundle)
4. Run `npm test` (234 unit tests)
5. Run Pi acceptance tests via vfa (Tier 1, 2, 3 + tool gating)
6. If all pass → extraction is safe

## Expected outcome

Confirmation that esbuild correctly bundles functions imported from `src/hooks/` into the Pi extension bundle, and that Pi loads and runs the extension normally. Or: identification of specific constraints that require a different extraction approach.
