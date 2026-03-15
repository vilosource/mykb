import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BRAIN_DIR = '.mykb';

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export function resolveBrainPath(): string {
  const envDir = process.env.MYKB_DIR;
  if (envDir) {
    return expandTilde(envDir);
  }
  return path.join(os.homedir(), DEFAULT_BRAIN_DIR);
}

export function brainExists(brainPath: string): boolean {
  try {
    return fs.statSync(brainPath).isDirectory();
  } catch {
    return false;
  }
}
