import fs from 'node:fs';
import path from 'node:path';

declare const __MYKB_VERSION__: string | undefined;

/** Resolve the package version, preferring a build-time injected constant. */
export function readVersion(startDir: string): string {
  if (typeof __MYKB_VERSION__ !== 'undefined') {
    return __MYKB_VERSION__;
  }
  return readVersionFromDisk(startDir);
}

/** Walk up from startDir looking for package.json to read the version field. */
export function readVersionFromDisk(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
      return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}
