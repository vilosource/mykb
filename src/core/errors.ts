export class BrainNotInitializedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrainNotInitializedError';
  }
}

export class AreaNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AreaNotFoundError';
  }
}

export class EntryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryNotFoundError';
  }
}

export class EntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryValidationError';
  }
}

export class StoreCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreCorruptionError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}
