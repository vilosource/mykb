import { describe, it, expect } from 'vitest';
import {
  BrainNotInitializedError,
  AreaNotFoundError,
  EntryNotFoundError,
  EntryValidationError,
  StoreCorruptionError,
  DatabaseError,
} from '../../src/core/errors.js';

const errorCases = [
  {
    ErrorClass: BrainNotInitializedError,
    name: 'BrainNotInitializedError',
    message: 'brain not found',
  },
  {
    ErrorClass: AreaNotFoundError,
    name: 'AreaNotFoundError',
    message: 'area "networking" not found',
  },
  {
    ErrorClass: EntryNotFoundError,
    name: 'EntryNotFoundError',
    message: 'entry "abc123" not found',
  },
  {
    ErrorClass: EntryValidationError,
    name: 'EntryValidationError',
    message: 'missing required field: text',
  },
  {
    ErrorClass: StoreCorruptionError,
    name: 'StoreCorruptionError',
    message: 'malformed JSONL at line 42',
  },
  { ErrorClass: DatabaseError, name: 'DatabaseError', message: 'SQLite operation failed' },
] as const;

describe('domain error classes', () => {
  describe.each(errorCases)('$name', ({ ErrorClass, name, message }) => {
    it('should be constructable with a message', () => {
      const error = new ErrorClass(message);
      expect(error.message).toBe(message);
    });

    it('should have the correct name property', () => {
      const error = new ErrorClass(message);
      expect(error.name).toBe(name);
    });

    it('should be an instance of Error', () => {
      const error = new ErrorClass(message);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
