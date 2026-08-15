import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scheduler } from '../src/modules/scheduler';
import type { Env, BingImage } from '../src/types';

function makeImage(overrides: Partial<BingImage> = {}): BingImage {
  return {
    startdate: '20260115',
    fullstartdate: '202601151200',
    enddate: '20260116',
    url: '/th?id=OHR.AlpsSunrise_EN-US1234567890_1920x1080.jpg',
    urlbase: '/th?id=OHR.AlpsSunrise_EN-US1234567890',
    copyright: 'Alps',
    copyrightlink: 'https://www.bing.com',
    title: 'Sunrise Over the Alps',
    quiz: '',
    wp: true,
    hsh: 'abc123',
    drk: 0,
    top: 0,
    bot: 0,
    hs: [],
    ...overrides,
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    IMG_BED_URL: 'https://imgbed.example.com',
    IMG_BED_AUTH_CODE: 'secret',
    BING_RESOLUTION: '1920x1080',
    BING_MARKET: 'en-US',
    ...overrides,
  };
}

// A minimal D1-backed db stub whose isAlreadyUploaded/recordUpload are vi mocks.
function makeMockDb(opts: { alreadyUploaded?: boolean; initFails?: boolean } = {}) {
  return {
    initialize: vi.fn().mockImplementation(() => {
      if (opts.initFails) return Promise.reject(new Error('D1 down'));
      return Promise.resolve();
    }),
    isAlreadyUploaded: vi.fn().mockResolvedValue(opts.alreadyUploaded ?? false),
    recordUpload: vi.fn().mockResolvedValue(undefined),
  };
}

// Build a Scheduler with mocked BingClient and ImgBedClient to test orchestration logic
// without real network calls.
function makeSchedulerWithMocks(env: Env, opts: {
  fetchWallpaper?: BingImage;
  fetchMultiple?: BingImage[];
  uploadUrl?: string;
  uploadMultipleResults?: Array<{ success: boolean; imageUrl?: string; error?: string }>;
  downloadData?: ArrayBuffer;
  downloadImpl?: (url: string) => Promise<ArrayBuffer>;
}) {
  const scheduler = new Scheduler(env);

  const bingClient = scheduler['bingClient'];
  bingClient.fetchWallpaper = vi.fn().mockResolvedValue(opts.fetchWallpaper ?? makeImage());
  bingClient.fetchMultipleWallpapers = vi.fn().mockResolvedValue(opts.fetchMultiple ?? [makeImage()]);
  bingClient.buildImageUrl = vi.fn().mockImplementation((image: BingImage) => {
    return `https://www.bing.com/${image.startdate}.jpg`;
  });
  bingClient.downloadImage = opts.downloadImpl
    ? vi.fn(opts.downloadImpl)
    : vi.fn().mockResolvedValue(opts.downloadData ?? new ArrayBuffer(10));

  const imgBedClient = scheduler['imgBedClient'];
  imgBedClient.upload = vi.fn().mockResolvedValue(opts.uploadUrl ?? 'https://imgbed.example.com/file/abc');
  imgBedClient.uploadMultiple = vi.fn().mockResolvedValue(
    opts.uploadMultipleResults ?? [{ success: true, imageUrl: 'https://imgbed.example.com/file/abc' }]
  );

  return { scheduler, bingClient, imgBedClient };
}

describe('Scheduler.initDb', () => {
  it('skips initialization when D1 binding is absent', async () => {
    const env = makeEnv();
    const { scheduler } = makeSchedulerWithMocks(env, {});
    await expect(scheduler.initDb()).resolves.toBeUndefined();
  });

  it('disables D1 usage after a failed initialization', async () => {
    const failingDb = makeMockDb({ initFails: true });
    const env = makeEnv();
    const { scheduler } = makeSchedulerWithMocks(env, {});
    // Inject the mock db directly (bypass the env.DB constructor path)
    (scheduler as unknown as { db: unknown })['db'] = failingDb as unknown;

    await scheduler.initDb();
    expect((scheduler as unknown as { db: unknown })['db']).toBeUndefined();
  });
});

describe('Scheduler.runDailyUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads today wallpaper end-to-end', async () => {
    const env = makeEnv();
    const { scheduler, bingClient, imgBedClient } = makeSchedulerWithMocks(env, {
      fetchWallpaper: makeImage({ startdate: '20260115', title: 'Alps' }),
    });

    const result = await scheduler.runDailyUpload();

    expect(result.success).toBe(true);
    expect(result.imageUrl).toBe('https://imgbed.example.com/file/abc');
    expect(bingClient.fetchWallpaper).toHaveBeenCalledOnce();
    expect(bingClient.downloadImage).toHaveBeenCalledOnce();
    expect(imgBedClient.upload).toHaveBeenCalledOnce();
  });

  it('returns failure when Bing fetch throws', async () => {
    const env = makeEnv();
    const { scheduler, bingClient } = makeSchedulerWithMocks(env, {});
    bingClient.fetchWallpaper = vi.fn().mockRejectedValue(new Error('Bing API down'));

    const result = await scheduler.runDailyUpload();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Bing API down');
  });

  it('returns failure when upload throws', async () => {
    const env = makeEnv();
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {});
    imgBedClient.upload = vi.fn().mockRejectedValue(new Error('ImgBed rejected'));

    const result = await scheduler.runDailyUpload();

    expect(result.success).toBe(false);
    expect(result.error).toBe('ImgBed rejected');
  });

  it('skips when wallpaper already uploaded (D1 idempotency)', async () => {
    const env = makeEnv();
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {});
    const db = makeMockDb({ alreadyUploaded: true });
    (scheduler as unknown as { db: unknown })['db'] = db;

    const result = await scheduler.runDailyUpload();

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(db.isAlreadyUploaded).toHaveBeenCalledWith('20260115');
    expect(imgBedClient.upload).not.toHaveBeenCalled();
  });
});

describe('Scheduler.runMultiDayUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns results in chronological order even with mixed success/failure', async () => {
    const env = makeEnv();
    const wallpapers = [
      makeImage({ startdate: '20260101', title: 'Day1' }),
      makeImage({ startdate: '20260102', title: 'Day2' }),
      makeImage({ startdate: '20260103', title: 'Day3' }),
    ];
    const downloadData = new ArrayBuffer(5);
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {
      fetchMultiple: wallpapers,
      downloadImpl: (url: string) => {
        if (url.includes('20260102')) {
          return Promise.reject(new Error('download failed for day2'));
        }
        return Promise.resolve(downloadData);
      },
    });
    imgBedClient.uploadMultiple = vi.fn().mockResolvedValue([
      { success: true, imageUrl: 'https://imgbed.example.com/file/1' },
      { success: true, imageUrl: 'https://imgbed.example.com/file/3' },
    ]);

    const result = await scheduler.runMultiDayUpload(3);

    expect(result.success).toBe(false); // one failure
    const dates = result.results.map(r => r.date);
    // Must stay chronological even though Day2 download failed and Day3 succeeded.
    expect(dates).toEqual(['20260101', '20260102', '20260103']);
    const day2 = result.results.find(r => r.date === '20260102');
    expect(day2?.error).toBeDefined();
    expect(result.results.find(r => r.date === '20260101')?.imageUrl).toBe('https://imgbed.example.com/file/1');
    expect(result.results.find(r => r.date === '20260103')?.imageUrl).toBe('https://imgbed.example.com/file/3');
  });

  it('returns success when all uploads succeed', async () => {
    const env = makeEnv();
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {
      fetchMultiple: [makeImage({ startdate: '20260101' }), makeImage({ startdate: '20260102' })],
    });
    imgBedClient.uploadMultiple = vi.fn().mockResolvedValue([
      { success: true, imageUrl: 'https://imgbed.example.com/file/1' },
      { success: true, imageUrl: 'https://imgbed.example.com/file/2' },
    ]);

    const result = await scheduler.runMultiDayUpload(2);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(r => r.imageUrl)).toBe(true);
  });

  it('handles all-already-uploaded case (all skipped)', async () => {
    const env = makeEnv();
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {
      fetchMultiple: [makeImage({ startdate: '20260101' }), makeImage({ startdate: '20260102' })],
    });
    const db = makeMockDb({ alreadyUploaded: true });
    (scheduler as unknown as { db: unknown })['db'] = db;

    const result = await scheduler.runMultiDayUpload(2);

    expect(result.success).toBe(true);
    expect(result.results.every(r => r.skipped === true)).toBe(true);
    expect(imgBedClient.uploadMultiple).not.toHaveBeenCalled();
  });
});

describe('Scheduler.runSpecificDateUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads the wallpaper for the given daysAgo', async () => {
    const env = makeEnv();
    const { scheduler, bingClient, imgBedClient } = makeSchedulerWithMocks(env, {
      fetchWallpaper: makeImage({ startdate: '20260114', title: 'Yesterday' }),
    });

    const result = await scheduler.runSpecificDateUpload(1);

    expect(result.success).toBe(true);
    expect(bingClient.fetchWallpaper).toHaveBeenCalledOnce();
    expect(imgBedClient.upload).toHaveBeenCalledOnce();
  });

  it('returns failure when download fails', async () => {
    const env = makeEnv();
    const { scheduler, bingClient } = makeSchedulerWithMocks(env, {});
    bingClient.downloadImage = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await scheduler.runSpecificDateUpload(0);

    expect(result.success).toBe(false);
    expect(result.error).toBe('network error');
  });

  it('skips when the date was already uploaded', async () => {
    const env = makeEnv();
    const { scheduler, imgBedClient } = makeSchedulerWithMocks(env, {});
    const db = makeMockDb({ alreadyUploaded: true });
    (scheduler as unknown as { db: unknown })['db'] = db;

    const result = await scheduler.runSpecificDateUpload(2);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(imgBedClient.upload).not.toHaveBeenCalled();
  });
});
