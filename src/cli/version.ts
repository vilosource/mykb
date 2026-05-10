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

/**
 * Walk up from startDir looking for a package.json with a usable
 * version field.
 *
 * Skips package.json files where `version` is missing, empty, or
 * non-string — they're typically intermediate manifests (like the
 * Pi-extension manifest at dist/package.json which carries name +
 * type + pi.extensions but no version). Without this guard, the walk
 * would stop at the first package.json found, return undefined, and
 * commander would silently disable the --version flag.
 */
export function readVersionFromDisk(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        return pkg.version;
      }
    }
    dir = path.dirname(dir);
  }
  return '0.0.0';
}
