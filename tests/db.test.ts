import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { WallpaperDB } from '../src/modules/db';
import { Logger } from '../src/modules/utils';

function createDatabase(): D1Database {
  return { exec: vi.fn().mockResolvedValue(undefined) } as unknown as D1Database;
}

describe('WallpaperDB.initialize', () => {
  it('shares schema initialization for the same D1 binding', async () => {
    const database = createDatabase();
    const logger = new Logger('error');

    await Promise.all([
      new WallpaperDB(database, logger).initialize(),
      new WallpaperDB(database, logger).initialize()
    ]);

    expect(database.exec).toHaveBeenCalledTimes(1);
  });

  it('allows a later initialization attempt after a failure', async () => {
    const database = createDatabase();
    const exec = database.exec as ReturnType<typeof vi.fn>;
    exec.mockRejectedValueOnce(new Error('temporary D1 failure')).mockResolvedValueOnce(undefined);
    const logger = new Logger('error');

    await expect(new WallpaperDB(database, logger).initialize()).rejects.toThrow('temporary D1 failure');
    await expect(new WallpaperDB(database, logger).initialize()).resolves.toBeUndefined();

    expect(exec).toHaveBeenCalledTimes(2);
  });
});
