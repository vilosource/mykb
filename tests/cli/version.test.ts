import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readVersionFromDisk } from '../../src/cli/version.js';

describe('readVersionFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mykb-version-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const tests = [
    {
      name: 'should find version in same directory',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
        return dir;
      },
      expected: '1.2.3',
    },
    {
      name: 'should find version walking up one level',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
        const child = path.join(dir, 'sub');
        fs.mkdirSync(child);
        return child;
      },
      expected: '2.0.0',
    },
    {
      name: 'should find version walking up multiple levels',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '3.1.4' }));
        const deep = path.join(dir, 'a', 'b', 'c');
        fs.mkdirSync(deep, { recursive: true });
        return deep;
      },
      expected: '3.1.4',
    },
    {
      name: 'should return 0.0.0 when no package.json found',
      setup: (dir: string) => {
        // Create a deeply nested dir with no package.json anywhere nearby
        const deep = path.join(dir, 'no-pkg', 'a', 'b', 'c', 'd', 'e');
        fs.mkdirSync(deep, { recursive: true });
        return deep;
      },
      expected: '0.0.0',
    },
    {
      // Regression: dist/package.json (a Pi-extension manifest with
      // name+type+pi but no version field) was found first by the walk
      // and pkg.version came back undefined. Commander then saw an
      // undefined version, registered no --version flag, and `kb -V`
      // failed with "unknown option". The fix: skip package.json
      // files whose `version` is missing, empty, or non-string and
      // keep walking up to find the real one.
      name: 'should skip package.json without a version field and continue walking up',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '4.5.6' }));
        const child = path.join(dir, 'sub');
        fs.mkdirSync(child);
        // Pi-extension manifest at the inner level — name + type but no version.
        fs.writeFileSync(
          path.join(child, 'package.json'),
          JSON.stringify({ name: 'mykb', type: 'module', pi: { extensions: ['./index.js'] } }),
        );
        return child;
      },
      expected: '4.5.6',
    },
    {
      name: 'should skip package.json with empty-string version and continue walking up',
      setup: (dir: string) => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '7.8.9' }));
        const child = path.join(dir, 'sub');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(child, 'package.json'), JSON.stringify({ version: '' }));
        return child;
      },
      expected: '7.8.9',
    },
  ];

  for (const tt of tests) {
    it(tt.name, () => {
      const startDir = tt.setup(tmpDir);
      const result = readVersionFromDisk(startDir);
      expect(result).toBe(tt.expected);
    });
  }
});
