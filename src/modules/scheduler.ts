import type { Env, BingImage } from '../types';
import { Config } from './config';
import { BingClient } from './bing';
import { ImgBedClient } from './upload';
import { Logger } from './utils';
import { generateFilename } from './utils';
import { WallpaperDB } from './db';

/**
 * Scheduler module
 * Orchestrates the entire workflow: fetch wallpaper from Bing -> download -> upload to ImgBed
 * With D1-based idempotency to prevent duplicate uploads
 */
export class Scheduler {
  private config: Config;
  private bingClient: BingClient;
  private imgBedClient: ImgBedClient;
  private logger: Logger;
  private db?: WallpaperDB;

  constructor(env: Env) {
    this.config = new Config(env);
    this.logger = new Logger(this.config.logLevel);

    this.config.validate();

    this.bingClient = new BingClient(this.logger);
    this.imgBedClient = new ImgBedClient(this.config.imgBedUrl, this.logger);

    // Initialize D1 if binding is configured
    if (env.DB) {
      this.db = new WallpaperDB(env.DB, this.logger);
    }
  }

  /**
   * Initialize D1 database table (safe to call multiple times).
   */
  async initDb(): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.initialize();
    } catch (error) {
      // D1 is optional; do not prevent uploads when its schema is unavailable.
      this.logger.warn('Failed to initialize D1 database; continuing without idempotency', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Main workflow: fetch today's Bing wallpaper and upload to ImgBed
   */
  async runDailyUpload(): Promise<{ success: boolean; imageUrl?: string; error?: string; skipped?: boolean }> {
    this.logger.info('Starting daily Bing wallpaper upload');

    try {
      // Step 1: Fetch wallpaper metadata from Bing
      const wallpaper = await this.bingClient.fetchWallpaper(this.config.bingConfig);

      // Step 2: Check idempotency — skip if already uploaded
      if (this.db && wallpaper.startdate) {
        const alreadyUploaded = await this.db.isAlreadyUploaded(wallpaper.startdate);
        if (alreadyUploaded) {
          this.logger.info('Wallpaper already uploaded, skipping', { date: wallpaper.startdate });
          return { success: true, skipped: true };
        }
      }

      // Step 3: Build image URL with desired resolution
      const resolution = this.config.bingConfig.resolution || '1920x1080';
      const imageUrl = this.bingClient.buildImageUrl(wallpaper, resolution);

      // Step 4: Download the image (with retry via fetchWithRetry)
      const imageData = await this.bingClient.downloadImage(imageUrl);

      // Step 5: Upload to ImgBed
      const filename = generateFilename(wallpaper, resolution);
      const uploadedUrl = await this.imgBedClient.upload(
        imageData,
        filename,
        this.config.imgBedConfig
      );

      // Step 6: Record successful upload in D1
      if (this.db && wallpaper.startdate) {
        await this.db.recordUpload(wallpaper.startdate, uploadedUrl);
      }

      this.logger.info('Daily upload completed successfully', {
        imageUrl: uploadedUrl,
        wallpaperTitle: wallpaper.title,
        date: wallpaper.startdate
      });

      return {
        success: true,
        imageUrl: uploadedUrl
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Daily upload failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Fetch and upload multiple wallpapers (e.g., past 7 days)
   * Downloads are parallelized for speed, uploads use configurable concurrency
   * @param days - Number of days to fetch
   */
  async runMultiDayUpload(days: number = 7): Promise<{
    success: boolean;
    results: Array<{ date: string; imageUrl?: string; error?: string; skipped?: boolean }>;
  }> {
    this.logger.info(`Starting multi-day upload for ${days} days`);

    const results: Array<{ date: string; imageUrl?: string; error?: string; skipped?: boolean }> = [];

    try {
      // Step 1: Fetch multiple wallpapers from Bing
      const wallpapers = await this.bingClient.fetchMultipleWallpapers(
        days,
        this.config.createBingConfig({ n: days })
      );

      // Step 2: Filter out already-uploaded dates (idempotency)
      const newWallpapers: typeof wallpapers = [];
      for (const wallpaper of wallpapers) {
        if (this.db && wallpaper.startdate) {
          const alreadyUploaded = await this.db.isAlreadyUploaded(wallpaper.startdate);
          if (alreadyUploaded) {
            this.logger.info('Wallpaper already uploaded, skipping', { date: wallpaper.startdate });
            results.push({ date: wallpaper.startdate, skipped: true });
            continue;
          }
        }
        newWallpapers.push(wallpaper);
      }

      if (newWallpapers.length === 0) {
        this.logger.info('All wallpapers already uploaded, nothing to do');
        return { success: true, results };
      }

      // Step 3: Download all images in parallel (with concurrency limit of 3)
      const resolution = this.config.bingConfig.resolution || '1920x1080';
      const downloadResults = await this.downloadImagesInParallel(newWallpapers, resolution, 3);

      // Step 4: Prepare upload payloads (only successful downloads)
      const uploads: Array<{ data: ArrayBuffer; filename: string; date: string }> = [];
      const downloadErrors: Array<{ date: string; error: string }> = [];

      for (let i = 0; i < newWallpapers.length; i++) {
        const wallpaper = newWallpapers[i];
        const downloadResult = downloadResults[i];

        if (downloadResult.success && downloadResult.data) {
          const filename = generateFilename(wallpaper, resolution);
          uploads.push({
            data: downloadResult.data,
            filename,
            date: wallpaper.startdate
          });
        } else {
          downloadErrors.push({
            date: wallpaper.startdate,
            error: downloadResult.error || 'Download failed'
          });
        }
      }

      // Step 5: Upload in parallel
      const uploadResults = uploads.length > 0
        ? await this.imgBedClient.uploadMultiple(uploads, this.config.imgBedConfig, 3)
        : [];

      // Step 6: Build results and record successful uploads
      for (let i = 0; i < uploads.length; i++) {
        const uploadResult = uploadResults[i];
        results.push({
          date: uploads[i].date,
          imageUrl: uploadResult?.success ? uploadResult.imageUrl : undefined,
          error: uploadResult && !uploadResult.success ? uploadResult.error : undefined
        });

        // Record to D1 if upload succeeded
        if (this.db && uploadResult?.success && uploadResult.imageUrl) {
          await this.db.recordUpload(uploads[i].date, uploadResult.imageUrl);
        }
      }

      // Add download errors to results
      for (const err of downloadErrors) {
        results.push({ date: err.date, error: err.error });
      }

      const failedCount = results.filter(result => result.error).length;
      const skippedCount = results.filter(result => result.skipped).length;
      this.logger.info(
        `Multi-day upload completed: ${results.length - failedCount - skippedCount} uploaded, ${skippedCount} skipped, ${failedCount} failed`
      );

      return {
        success: failedCount === 0,
        results
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Multi-day upload failed', { error: errorMessage });

      return {
        success: false,
        results
      };
    }
  }

  /**
   * Run a specific date's wallpaper upload
   * @param daysAgo - Days ago (0 = today, 1 = yesterday, etc.)
   */
  async runSpecificDateUpload(daysAgo: number): Promise<{ success: boolean; imageUrl?: string; error?: string; skipped?: boolean }> {
    this.logger.info(`Starting upload for ${daysAgo} day(s) ago`);

    try {
      // Fetch specific date wallpaper
      const wallpaper = await this.bingClient.fetchWallpaper(
        this.config.createBingConfig({ idx: daysAgo })
      );

      // Check idempotency
      if (this.db && wallpaper.startdate) {
        const alreadyUploaded = await this.db.isAlreadyUploaded(wallpaper.startdate);
        if (alreadyUploaded) {
          this.logger.info('Wallpaper already uploaded, skipping', { date: wallpaper.startdate });
          return { success: true, skipped: true };
        }
      }

      // Download and upload
      const resolution = this.config.bingConfig.resolution || '1920x1080';
      const imageUrl = this.bingClient.buildImageUrl(wallpaper, resolution);
      const imageData = await this.bingClient.downloadImage(imageUrl);
      const filename = generateFilename(wallpaper, resolution);

      const uploadedUrl = await this.imgBedClient.upload(
        imageData,
        filename,
        this.config.imgBedConfig
      );

      // Record to D1
      if (this.db && wallpaper.startdate) {
        await this.db.recordUpload(wallpaper.startdate, uploadedUrl);
      }

      this.logger.info('Specific date upload completed', {
        date: wallpaper.startdate,
        imageUrl: uploadedUrl
      });

      return {
        success: true,
        imageUrl: uploadedUrl
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Specific date upload failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Download multiple images in parallel with concurrency control
   * @param wallpapers - Array of wallpaper metadata
   * @param resolution - Image resolution
   * @param concurrency - Max concurrent downloads (default: 3)
   */
  private async downloadImagesInParallel(
    wallpapers: Pick<BingImage, 'startdate' | 'url' | 'urlbase'>[],
    resolution: string,
    concurrency: number = 3
  ): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }[]> {
    const results: { success: boolean; data?: ArrayBuffer; error?: string }[] = [];
    const total = wallpapers.length;

    for (let i = 0; i < total; i += concurrency) {
      const batch = wallpapers.slice(i, i + concurrency);
      const batchStart = i;

      this.logger.info(`Downloading batch ${Math.floor(i / concurrency) + 1}: items ${i + 1}-${Math.min(i + concurrency, total)}`);

      const batchResults = await Promise.allSettled(
        batch.map(async (wallpaper, batchIndex) => {
          const imageUrl = this.bingClient.buildImageUrl(wallpaper as BingImage, resolution);
          try {
            const data = await this.bingClient.downloadImage(imageUrl);
            return { index: batchStart + batchIndex, success: true as const, data };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { index: batchStart + batchIndex, success: false as const, error: errorMessage };
          }
        })
      );

      // Place results in correct order
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { index, success, data, error } = result.value;
          results[index] = { success, data, error };
        } else {
          // This shouldn't normally happen with the try/catch inside, but handle gracefully
          const idx = batchStart + batchResults.indexOf(result);
          results[idx] = { success: false, error: result.reason?.message || 'Unknown download error' };
        }
      }
    }

    return results;
  }
}