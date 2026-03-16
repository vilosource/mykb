import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import { executeKbWorkState } from '../../src/tools/kb-work-state.js';

describe('kb_work_state tool', () => {
  it('updates phase', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const result = await executeKbWorkState(wsStorage, { phase: 'implementation' });

      expect(result.content[0].text).toContain('test-ws');
      expect(result.content[0].text).toContain('phase');

      const ws = wsStorage.readWorkspace('test-ws')!;
      expect(ws.state.phase).toBe('implementation');
    });
  });

  it('updates multiple fields', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const result = await executeKbWorkState(wsStorage, {
        phase: 'testing',
        active: 'write unit tests',
        blocked: 'waiting for API docs',
        next: 'integration tests',
      });

      expect(result.content[0].text).toContain('Updated');

      const ws = wsStorage.readWorkspace('test-ws')!;
      expect(ws.state.phase).toBe('testing');
      expect(ws.state.active).toBe('write unit tests');
      expect(ws.state.blocked).toBe('waiting for API docs');
      expect(ws.state.next).toBe('integration tests');
    });
  });

  it('errors when no active workspace', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);

      const result = await executeKbWorkState(wsStorage, { phase: 'test' });

      expect(result.content[0].text).toContain('No active workspace');
    });
  });
});
