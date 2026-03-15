import { describe, it, expect } from 'vitest';
import { SessionState } from '../../src/extension/state.js';
import {
  createToolCallHandler,
  createToolResultHandler,
  createInputHandler,
} from '../../src/extension/hooks/signals.js';

describe('Signal collection hooks', () => {
  describe('tool_call handler', () => {
    it('extracts file path from read tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        tool: 'Read',
        params: { file_path: '/home/user/project/terraform/main.tf' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/terraform/main.tf');
    });

    it('extracts file path from write tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        tool: 'Write',
        params: { file_path: '/home/user/project/src/vault.ts' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
      expect(state.signals[0].value).toBe('/home/user/project/src/vault.ts');
    });

    it('extracts file path from edit tool call', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        tool: 'Edit',
        params: { file_path: '/home/user/project/config/dns.yaml' },
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('file_path');
    });

    it('ignores tool calls without file_path', async () => {
      const state = new SessionState();
      const handler = createToolCallHandler(state);

      await handler({
        tool: 'Bash',
        params: { command: 'ls -la' },
      });

      expect(state.signals).toHaveLength(0);
    });
  });

  describe('tool_result handler', () => {
    it('extracts keywords from bash output', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        tool: 'Bash',
        output: 'Successfully applied terraform plan for VPN gateway',
      });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('keyword');
      expect(state.signals[0].value).toContain('terraform');
    });

    it('ignores empty output', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      await handler({
        tool: 'Bash',
        output: '',
      });

      expect(state.signals).toHaveLength(0);
    });

    it('truncates very long output', async () => {
      const state = new SessionState();
      const handler = createToolResultHandler(state);

      const longOutput = 'word '.repeat(1000);
      await handler({
        tool: 'Bash',
        output: longOutput,
      });

      expect(state.signals).toHaveLength(1);
      // Should be truncated to a reasonable length
      expect(state.signals[0].value.length).toBeLessThan(longOutput.length);
    });
  });

  describe('input handler', () => {
    it('adds user prompt as keyword signal', async () => {
      const state = new SessionState();
      const handler = createInputHandler(state);

      await handler({ text: 'How do I configure the VPN firewall?' });

      expect(state.signals).toHaveLength(1);
      expect(state.signals[0].type).toBe('keyword');
      expect(state.signals[0].value).toBe('How do I configure the VPN firewall?');
    });

    it('ignores empty input', async () => {
      const state = new SessionState();
      const handler = createInputHandler(state);

      await handler({ text: '' });

      expect(state.signals).toHaveLength(0);
    });
  });
});
