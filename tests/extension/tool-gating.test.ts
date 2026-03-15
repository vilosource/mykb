import { describe, it, expect } from 'vitest';
import { createToolGatingHandler } from '../../src/extension/hooks/tool-gating.js';

describe('Tool gating handler', () => {
  const brainPath = '/home/user/.mykb';
  const handler = createToolGatingHandler(brainPath);

  it('blocks write to .jsonl file', async () => {
    const result = await handler({
      toolName: 'write',
      input: { file_path: '/some/path/entries.jsonl' },
    });
    expect(result).toEqual({
      block: true,
      reason:
        'Do not edit knowledge files directly. Use the kb_add, kb_update, or kb_verify tools instead to manage knowledge entries.',
    });
  });

  it('blocks write to area.json', async () => {
    const result = await handler({
      toolName: 'write',
      input: { file_path: '/home/user/.mykb/networking/area.json' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });

  it('blocks write to manifest.json', async () => {
    const result = await handler({
      toolName: 'write',
      input: { file_path: '/home/user/.mykb/manifest.json' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });

  it('blocks write to file inside brainPath', async () => {
    const result = await handler({
      toolName: 'write',
      input: { file_path: '/home/user/.mykb/networking/data.txt' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });

  it('returns undefined for write to unrelated file', async () => {
    const result = await handler({
      toolName: 'write',
      input: { file_path: '/home/user/project/src/index.ts' },
    });
    expect(result).toBeUndefined();
  });

  it('blocks edit to .jsonl file', async () => {
    const result = await handler({
      toolName: 'edit',
      input: { file_path: '/some/path/entries.jsonl' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });

  it('returns undefined for read tool (only blocks write/edit)', async () => {
    const result = await handler({
      toolName: 'read',
      input: { file_path: '/home/user/.mykb/networking/entries.jsonl' },
    });
    expect(result).toBeUndefined();
  });

  it('extracts file path from path parameter', async () => {
    const result = await handler({
      toolName: 'write',
      input: { path: '/home/user/.mykb/networking/entries.jsonl' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });

  it('extracts file path from filePath parameter', async () => {
    const result = await handler({
      toolName: 'edit',
      input: { filePath: '/home/user/.mykb/networking/entries.jsonl' },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('Do not edit knowledge files directly'),
    });
  });
});
