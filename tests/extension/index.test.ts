import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTempBrain } from '../helpers.js';
import extensionDefault from '../../src/extension/index.js';
import type { ExtensionAPI } from '../../src/extension/pi-types.js';

// Regression for the v2 area-scoring scenario (scoring-without-tools.sh):
// the harness sets MYKB_DISABLE_TOOLS=1 in the container env to isolate
// the scorer/system-prompt knowledge path from the tool-use path. The
// extension must read that env and skip registerTools(), so the LLM
// has no kb_search/kb_list/kb_load to fall back on.

function createMockPi(): ExtensionAPI & { toolNames: string[] } {
  const toolNames: string[] = [];
  return {
    toolNames,
    on: vi.fn(),
    registerTool: vi.fn((tool: { name: string }) => {
      toolNames.push(tool.name);
    }),
    registerCommand: vi.fn(),
  };
}

describe('extension entry point', () => {
  const originalEnv = process.env.MYKB_DISABLE_TOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MYKB_DISABLE_TOOLS;
    } else {
      process.env.MYKB_DISABLE_TOOLS = originalEnv;
    }
  });

  it('registers kb tools by default', async () => {
    delete process.env.MYKB_DISABLE_TOOLS;
    await withTempBrain((brainPath) => {
      process.env.MYKB_DIR = brainPath;
      const pi = createMockPi();
      extensionDefault(pi);
      expect(pi.toolNames).toContain('kb_search');
      expect(pi.toolNames).toContain('kb_list');
      expect(pi.toolNames).toContain('kb_load');
      return Promise.resolve();
    });
  });

  it('skips kb tool registration when MYKB_DISABLE_TOOLS=1', async () => {
    process.env.MYKB_DISABLE_TOOLS = '1';
    await withTempBrain((brainPath) => {
      process.env.MYKB_DIR = brainPath;
      const pi = createMockPi();
      extensionDefault(pi);
      expect(pi.toolNames).toEqual([]);
      return Promise.resolve();
    });
  });

  it('treats MYKB_DISABLE_TOOLS=0 as enabled (registers tools)', async () => {
    process.env.MYKB_DISABLE_TOOLS = '0';
    await withTempBrain((brainPath) => {
      process.env.MYKB_DIR = brainPath;
      const pi = createMockPi();
      extensionDefault(pi);
      expect(pi.toolNames.length).toBeGreaterThan(0);
      return Promise.resolve();
    });
  });
});
