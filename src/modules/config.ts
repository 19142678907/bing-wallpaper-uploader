import type { Env, BingImageConfig, ImgBedUploadConfig, RetryConfig } from '../types';

const BING_RESOLUTIONS = ['1920x1080', 'UHD', '3840x2160', '2560x1440'] as const;
type BingResolution = (typeof BING_RESOLUTIONS)[number];

/**
 * Configuration management module
 * Centralizes all configuration for easy modification and extension
 */
export class Config {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Get ImgBed base URL
   */
  get imgBedUrl(): string {
    const url = this.env.IMG_BED_URL;
    if (!url) {
      throw new Error('IMG_BED_URL environment variable is required');
    }
    return url;
  }

  /**
   * Get ImgBed upload configuration
   */
  get imgBedConfig(): ImgBedUploadConfig {
    return {
      authCode: this.env.IMG_BED_AUTH_CODE,
      uploadChannel: this.env.IMG_BED_CHANNEL || 'telegram',
      autoRetry: true,
      uploadFolder: 'bing-wallpapers'
    };
  }

  /**
   * Get Bing Wallpaper API configuration
   */
  get bingConfig(): BingImageConfig {
    const resolution = this.getBingResolution();
    return {
      idx: 0, // Today's wallpaper
      n: 1,   // Get one image
      mkt: this.env.BING_MARKET || 'en-US',
      resolution
    };
  }

  /**
   * Get retry configuration
   */
  get retryConfig(): RetryConfig {
    return {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2
    };
  }

  /**
   * Get log level
   */
  get logLevel(): string {
    return this.env.LOG_LEVEL || 'info';
  }

  /**
   * Check if all required environment variables are set
   */
  validate(): void {
    const required: (keyof Env)[] = ['IMG_BED_URL', 'IMG_BED_AUTH_CODE'];
    const missing: string[] = [];

    for (const key of required) {
      if (!this.env[key]) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    this.getBingResolution();
  }

  /**
   * Get TRIGGER_TOKEN for manual trigger authentication
   */
  get triggerToken(): string | undefined {
    return this.env.TRIGGER_TOKEN;
  }

  /**
   * Get D1 database binding
   */
  get db(): D1Database | undefined {
    return this.env.DB;
  }

  /**
   * Create a new Bing configuration with custom parameters
   * Useful for fetching past wallpapers
   */
  createBingConfig(overrides: Partial<BingImageConfig>): BingImageConfig {
    return {
      ...this.bingConfig,
      ...overrides
    };
  }

  /**
   * Create a new ImgBed configuration with custom parameters
   * Useful for different upload scenarios
   */
  createImgBedConfig(overrides: Partial<ImgBedUploadConfig>): ImgBedUploadConfig {
    return {
      ...this.imgBedConfig,
      ...overrides
    };
  }

  private getBingResolution(): BingResolution {
    const resolution = this.env.BING_RESOLUTION || '1920x1080';

    if (!BING_RESOLUTIONS.includes(resolution as BingResolution)) {
      throw new Error(`Invalid BING_RESOLUTION: ${resolution}. Valid values: ${BING_RESOLUTIONS.join(', ')}`);
    }

    return resolution as BingResolution;
  }
}
