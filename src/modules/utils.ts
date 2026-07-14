import { LogLevel, type LogEntry, type BingImage } from '../types';

/**
 * Simple logger for Cloudflare Workers
 */
export class Logger {
  private level: LogLevel;
  private levelMap: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR
  };

  constructor(levelStr: string = 'info') {
    this.level = this.levelMap[levelStr.toLowerCase()] || LogLevel.INFO;
  }

  private format(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const entry = this.format(LogLevel.DEBUG, message, context);
      console.log(`[DEBUG] ${entry.timestamp} - ${message}`, context ? JSON.stringify(context) : '');
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const entry = this.format(LogLevel.INFO, message, context);
      console.log(`[INFO] ${entry.timestamp} - ${message}`, context ? JSON.stringify(context) : '');
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const entry = this.format(LogLevel.WARN, message, context);
      console.warn(`[WARN] ${entry.timestamp} - ${message}`, context ? JSON.stringify(context) : '');
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const entry = this.format(LogLevel.ERROR, message, context);
      console.error(`[ERROR] ${entry.timestamp} - ${message}`, context ? JSON.stringify(context) : '');
    }
  }
}

/**
 * Custom error classes
 */
export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export class UploadError extends Error {
  public readonly statusCode?: number;
  public readonly responseText?: string;

  constructor(message: string, statusCode?: number, responseText?: string) {
    super(message);
    this.name = 'UploadError';
    this.statusCode = statusCode;
    this.responseText = responseText;
  }
}

export class FetchError extends Error {
  public readonly statusCode?: number;
  public readonly responseText?: string;

  constructor(message: string, statusCode?: number, responseText?: string) {
    super(message);
    this.name = 'FetchError';
    this.statusCode = statusCode;
    this.responseText = responseText;
  }
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generic retry with exponential backoff.
 * Does not retry on 4xx client errors when the error has a statusCode property.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelay?: number; onRetry?: (error: unknown, attempt: number) => void } = {}
): Promise<T> {
  const { maxRetries = 3, initialDelay = 1000, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const e = error as { statusCode?: number };
      if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        if (onRetry) onRetry(error, attempt + 1);
        await sleep(delay);
      }
    }
  }

  throw new RetryError(
    'Failed after ' + (maxRetries + 1) + ' attempts',
    maxRetries + 1,
    lastError as Error
  );
}

/**
 * Format date to YYYYMMDD format
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Extract date from Bing image startdate (YYYYMMDD)
 */
export function parseBingDate(dateStr: string): Date {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(year, month, day);
}

/**
 * Generate filename from image info
 */
export function generateFilename(image: Pick<BingImage, 'startdate' | 'title'>, resolution: string): string {
  const date = image.startdate || formatDate(new Date());
  const title = image.title?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50) || 'wallpaper';
  return `bing_${date}_${title}_${resolution}.jpg`;
}
