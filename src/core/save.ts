import { execSync } from 'node:child_process';

function hasChanges(brainPath: string): boolean {
  const status = execSync('git status --porcelain', {
    cwd: brainPath,
    encoding: 'utf-8',
  }).trim();
  return status.length > 0;
}

export function save(brainPath: string, message?: string): void {
  if (!hasChanges(brainPath)) {
    return;
  }

  execSync('git add -A', { cwd: brainPath, stdio: 'pipe' });

  const commitMessage = message ?? `kb: save ${new Date().toISOString().slice(0, 19)}`;
  execSync(`git commit -m "${commitMessage}"`, { cwd: brainPath, stdio: 'pipe' });
}

export function saveAndPush(brainPath: string, message?: string): void {
  save(brainPath, message);
  execSync('git push', { cwd: brainPath, stdio: 'pipe' });
}
