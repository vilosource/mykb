import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import { executeKbWorkNote } from '../../src/tools/kb-work-note.js';

describe('kb_work_note tool', () => {
  it('appends note with tags', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const result = await executeKbWorkNote(wsStorage, {
        text: 'Login throws 500',
        tags: ['bug'],
      });

      expect(result.content[0].text).toContain('test-ws');
      expect(result.content[0].text).toContain('note');
      expect(result.content[0].text).toContain('bug');

      const notes = wsStorage.readNotes('test-ws');
      expect(notes).toHaveLength(1);
      expect(notes[0].text).toBe('Login throws 500');
      expect(notes[0].tags).toEqual(['bug']);
    });
  });

  it('appends note without tags', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const result = await executeKbWorkNote(wsStorage, { text: 'Just a thought' });

      expect(result.content[0].text).toContain('test-ws');

      const notes = wsStorage.readNotes('test-ws');
      expect(notes).toHaveLength(1);
      expect(notes[0].tags).toEqual([]);
    });
  });

  it('errors when no active workspace', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);

      const result = await executeKbWorkNote(wsStorage, { text: 'some note' });

      expect(result.content[0].text).toContain('No active workspace');
    });
  });
});
