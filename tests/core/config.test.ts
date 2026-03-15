import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { withTempBrain } from '../helpers.js';
import { resolveBrainPath, brainExists } from '../../src/core/config.js';

describe('resolveBrainPath', () => {
  const cases = [
    {
      scenario: 'should return MYKB_DIR when set',
      env: '/custom/brain/path',
      expected: '/custom/brain/path',
    },
    {
      scenario: 'should return ~/.mykb/ when MYKB_DIR is not set',
      env: undefined,
      expected: path.join(process.env.HOME ?? '', '.mykb'),
    },
    {
      scenario: 'should expand ~ in MYKB_DIR',
      env: '~/my-brain',
      expected: path.join(process.env.HOME ?? '', 'my-brain'),
    },
  ];

  it.each(cases)('$scenario', ({ env, expected }) => {
    const original = process.env.MYKB_DIR;
    try {
      if (env === undefined) {
        delete process.env.MYKB_DIR;
      } else {
        process.env.MYKB_DIR = env;
      }
      expect(resolveBrainPath()).toBe(expected);
    } finally {
      if (original === undefined) {
        delete process.env.MYKB_DIR;
      } else {
        process.env.MYKB_DIR = original;
      }
    }
  });
});

describe('brainExists', () => {
  it('should return true when brain directory exists', async () => {
    await withTempBrain(async (brainPath) => {
      expect(brainExists(brainPath)).toBe(true);
    });
  });

  it('should return false when brain directory is missing', () => {
    expect(brainExists('/nonexistent/path/that/does/not/exist')).toBe(false);
  });
});
