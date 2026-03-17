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
  ];

  for (const tt of tests) {
    it(tt.name, () => {
      const startDir = tt.setup(tmpDir);
      const result = readVersionFromDisk(startDir);
      expect(result).toBe(tt.expected);
    });
  }
});
