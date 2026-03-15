import { describe, it, expect } from 'vitest';
import { generateId } from '../../src/core/id.js';

describe('generateId', () => {
  it('should return an 8-character string', () => {
    const id = generateId();
    expect(id).toHaveLength(8);
  });

  it('should return alphanumeric characters only', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('should produce unique values across 100 calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});
