import { customAlphabet } from 'nanoid';

const ID_LENGTH = 8;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const nanoid = customAlphabet(ALPHABET, ID_LENGTH);

export function generateId(): string {
  return nanoid();
}
