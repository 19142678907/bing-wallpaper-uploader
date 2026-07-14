import type { D1Database } from '@cloudflare/workers-types';
import { Logger } from './utils';

/**
 * D1 Database operations for idempotency tracking
 * Stores uploaded wallpaper dates to prevent duplicate uploads
 */
export class WallpaperDB {
  private db: D1Database;
  private logger: Logger;

  constructor(db: D1Database, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Initialize the database table
   * Should be called once during setup/migration
   */
  async initialize(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS uploaded_wallpapers (
        date TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uploaded_at ON uploaded_wallpapers(uploaded_at);
    `);
    this.logger.info('D1 database initialized');
  }

  /**
   * Check if a wallpaper for a specific date has already been uploaded
   * @param date - Date string in YYYYMMDD format
   * @returns true if already uploaded, false otherwise
   */
  async isAlreadyUploaded(date: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('SELECT date FROM uploaded_wallpapers WHERE date = ?')
        .bind(date)
        .first();
      return result !== null;
    } catch (error) {
      this.logger.error('Failed to check upload status', { date, error: String(error) });
      return false; // On error, allow upload to proceed
    }
  }

  /**
   * Record a successful upload in the database
   * @param date - Date string in YYYYMMDD format
   * @param url - The uploaded image URL
   */
  async recordUpload(date: string, url: string): Promise<void> {
    try {
      await this.db
        .prepare('INSERT OR REPLACE INTO uploaded_wallpapers (date, url, uploaded_at) VALUES (?, ?, ?)')
        .bind(date, url, Date.now())
        .run();
      this.logger.info('Recorded upload to D1', { date, url });
    } catch (error) {
      this.logger.error('Failed to record upload', { date, error: String(error) });
      // Non-critical: continue even if D1 recording fails
    }
  }

  /**
   * Get all recorded uploads (for debugging/admin)
   * @returns List of uploaded wallpapers
   */
  async getAllUploads(): Promise<Array<{ date: string; url: string; uploaded_at: number }>> {
    const result = await this.db
      .prepare('SELECT date, url, uploaded_at FROM uploaded_wallpapers ORDER BY uploaded_at DESC')
      .all<{ date: string; url: string; uploaded_at: number }>();
    return result.results;
  }

  /**
   * Delete a specific upload record (for testing/cleanup)
   * @param date - Date string in YYYYMMDD format
   */
  async deleteUpload(date: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM uploaded_wallpapers WHERE date = ?')
      .bind(date)
      .run();
    this.logger.info('Deleted upload record', { date });
  }
}
