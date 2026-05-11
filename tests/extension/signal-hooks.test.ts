import { describe, it, expect } from 'vitest';
import { SessionState } from '../../src/extension/state.js';
import {
  createToolCallHandler,
  createToolResultHandler,
  createInputHandler,
} from '../../src/extension/hooks/signals.js';

// These handlers are registered against Pi's extension event bus, so the
// shapes below mirror Pi's ToolCallEvent / ToolResultEvent / InputEvent
// (see @mariozechner/pi-coding-agent core/extensions/types.d.ts):
//   tool_call   -> { type, toolCallId, toolName: 'read'|'write'|'edit'|..., input }
//   tool_result -> { type, toolCallId, input, content: TextContent[], isError, toolName }
//   input       -> { type, text, source }
// Pi names its built-in file tools in lowercase ('read'/'write'/'edit') and
// the file path lives under input.path (with input.file_path accepted as an
// alias for Claude-style tool args).

describe('Signal collection hooks', () => {
  describe('tool_call handler', () => {
    it('extracts file path from a read tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't1',
        toolName: 'read',
        input: { path: '/home/user/project/terraform/main.tf' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/terraform/main.tf');
    });

    it('extracts file path from a write tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't2',
        toolName: 'write',
        input: { path: '/home/user/project/src/vault.ts', content: 'export {}' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/src/vault.ts');
    });

    it('extracts file path from an edit tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't3',
        toolName: 'edit',
        input: { path: '/home/user/project/config/dns.yaml', edits: [] },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/config/dns.yaml');
    });

    it('accepts the file_path alias for the path field', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't4',
        toolName: 'read',
        input: { file_path: '/home/user/project/k8s/ingress.yaml' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/k8s/ingress.yaml');
    });

    it('matches tool names case-insensitively (Claude-style Read/Write/Edit)', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't5',
        toolName: 'Read',
        input: { file_path: '/home/user/project/ansible/site.yml' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/ansible/site.yml');
    });

    it('ignores tool calls for non-file tools', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't6',
        toolName: 'bash',
        input: { command: 'ls -la' },
      });

      expect(state.signals).toHaveLength(0);
    });

    it('ignores file tool calls without a path', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        type: 'tool_call',
        toolCallId: 't7',
        toolName: 'read',
        input: {},
      });

      expect(state.signals).toHaveLength(0);
    });
  });

  describe('tool_result handler', () => {
    it('extracts keywords from a tool result content block', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        type: 'tool_result',
        toolCallId: 't1',
        input: { command: 'terraform apply' },
        content: [{ type: 'text', text: 'Successfully applied terraform plan for VPN gateway' }],
        isError: false,
        toolName: 'bash',
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('keyword');
      expect(state.signals[0].value).toContain('terraform');
    });

    it('joins multiple text content blocks', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        type: 'tool_result',
        toolCallId: 't2',
        input: {},
        content: [
          { type: 'text', text: 'vault unseal' },
          { type: 'text', text: 'kubernetes ingress' },
        ],
        isError: false,
        toolName: 'bash',
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].value).toContain('vault');
      expect(state.signals[0].value).toContain('kubernetes');
    });

    it('ignores empty content', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        type: 'tool_result',
        toolCallId: 't3',
        input: {},
        content: [],
        isError: false,
        toolName: 'bash',
      });

      expect(state.signals).toHaveLength(0);
    });

    it('ignores non-text content blocks (e.g. images)', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        type: 'tool_result',
        toolCallId: 't4',
        input: {},
        content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }],
        isError: false,
        toolName: 'read',
      });

      expect(state.signals).toHaveLength(0);
    });

    it('truncates very long output', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      const longText = 'word '.repeat(1000);
      await handler({
        type: 'tool_result',
        toolCallId: 't5',
        input: {},
        content: [{ type: 'text', text: longText }],
        isError: false,
        toolName: 'bash',
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].value.length).toBeLessThan(longText.length);
    });
  });

  describe('input handler', () => {
    it('adds user prompt as a keyword signal', async () => {
      const state = new SessionState();
      const handler = createInputHandler(state);

      await handler({
        type: 'input',
        text: 'How do I configure the VPN firewall?',
        source: 'interactive',
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('keyword');
      expect(state.signals[0].value).toBe('How do I configure the VPN firewall?');
    });

    it('ignores empty input', async () => {
      const state = new SessionState();
      const handler = createInputHandler(state);

      await handler({ type: 'input', text: '', source: 'interactive' });

      expect(state.signals).toHaveLength(0);
    });
  });
});
