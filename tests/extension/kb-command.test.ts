import { describe, it, expect } from 'vitest';
import { withTempBrain } from '../helpers.js';
import { initBrain } from '../../src/core/init.js';
import { MykbStore } from '../../src/core/knowledge-store.js';
import { SessionState } from '../../src/extension/state.js';
import { createKbCommandHandler } from '../../src/extension/hooks/kb-command.js';

describe('/kb command handler', () => {
  it('parses area IDs and loads area entries', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('networking', 'VPN uses WireGuard', { tags: ['vpn'] });
        store.addFact('networking', 'DNS via Azure', { tags: ['dns'] });

        const state = new SessionState();
        const handler = createKbCommandHandler(store, state);

        let injectedContent = '';
        const mockCtx = {
          inject: (content: string) => {
            injectedContent = content;
          },
        };

        await handler.execute('networking', mockCtx);

        expect(injectedContent).toContain('VPN uses WireGuard');
        expect(injectedContent).toContain('DNS via Azure');
        expect(state.isAreaLoaded('networking')).toBe(true);
      } finally {
        store.close();
      }
    });
  });

  it('handles multiple area IDs', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        store.addFact('networking', 'Network fact');
        store.addFact('secrets', 'Secret fact');

        const state = new SessionState();
        const handler = createKbCommandHandler(store, state);

        let injectedContent = '';
        const mockCtx = {
          inject: (content: string) => {
            injectedContent = content;
          },
        };

        await handler.execute('networking secrets', mockCtx);

        expect(injectedContent).toContain('Network fact');
        expect(injectedContent).toContain('Secret fact');
        expect(state.isAreaLoaded('networking')).toBe(true);
        expect(state.isAreaLoaded('secrets')).toBe(true);
      } finally {
        store.close();
      }
    });
  });

  it('reports when area has no entries', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        const handler = createKbCommandHandler(store, state);

        let injectedContent = '';
        const mockCtx = {
          inject: (content: string) => {
            injectedContent = content;
          },
        };

        await handler.execute('nonexistent', mockCtx);

        expect(injectedContent).toContain('No entries found');
      } finally {
        store.close();
      }
    });
  });

  it('has correct description', async () => {
    await withTempBrain(async (brainPath) => {
      initBrain(brainPath);
      const store = MykbStore.open(brainPath);
      try {
        const state = new SessionState();
        const handler = createKbCommandHandler(store, state);
        expect(handler.description).toContain('Load knowledge areas');
      } finally {
        store.close();
      }
    });
  });
});
