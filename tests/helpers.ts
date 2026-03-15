import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function withTempBrain(fn: (brainPath: string) => Promise<void>): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-test-'));
  const originalEnv = process.env.MYKB_DIR;
  process.env.MYKB_DIR = tmpDir;
  try {
    await fn(tmpDir);
  } finally {
    process.env.MYKB_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
