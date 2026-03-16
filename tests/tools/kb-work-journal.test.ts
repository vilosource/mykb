import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { FileSystemWorkspaceStorage } from '../../src/core/workspace.js';
import { executeKbWorkJournal } from '../../src/tools/kb-work-journal.js';

describe('kb_work_journal tool', () => {
  it('appends journal entry', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);
      wsStorage.createWorkspace('test-ws', 'Test Workspace');
      wsStorage.setActiveWorkspaceId('test-ws');

      const result = await executeKbWorkJournal(wsStorage, { text: 'Completed DNS migration' });

      expect(result.content[0].text).toContain('test-ws');
      expect(result.content[0].text).toContain('journal');

      const entries = wsStorage.readJournal('test-ws');
      expect(entries).toHaveLength(1);
      expect(entries[0].text).toBe('Completed DNS migration');
    });
  });

  it('errors when no active workspace', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const wsStorage = new FileSystemWorkspaceStorage(brainPath);

      const result = await executeKbWorkJournal(wsStorage, { text: 'some entry' });

      expect(result.content[0].text).toContain('No active workspace');
    });
  });
});
