import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function withTempBrain(fn: (brainPath: string) => Promise<void>): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-test-'));
  const originalMykbDir = process.env.MYKB_DIR;
  // KB_SESSION_ID, when present in the ambient environment, redirects the
  // active-workspace pointer to a process-wide /tmp session file outside the
  // temp brain (see FileSystemWorkspaceStorage.sessionFile). Clear it so each
  // test starts from the .active-file fallback; tests that exercise the
  // session-isolation path set KB_SESSION_ID themselves inside the callback.
  const originalSessionId = process.env.KB_SESSION_ID;
  process.env.MYKB_DIR = tmpDir;
  delete process.env.KB_SESSION_ID;
  try {
    await fn(tmpDir);
  } finally {
    if (originalMykbDir === undefined) delete process.env.MYKB_DIR;
    else process.env.MYKB_DIR = originalMykbDir;
    if (originalSessionId === undefined) delete process.env.KB_SESSION_ID;
    else process.env.KB_SESSION_ID = originalSessionId;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
