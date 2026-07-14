/**
 * Bing Wallpaper API Response Types
 */
export interface BingImage {
  startdate: string;
  fullstartdate: string;
  enddate: string;
  url: string;
  urlbase: string;
  copyright: string;
  copyrightlink: string;
  title: string;
  quiz: string;
  wp: boolean;
  hsh: string;
  drk: number;
  top: number;
  bot: number;
  hs: string[];
}

export interface BingResponse {
  images: BingImage[];
  tooltips: {
    loading: string;
    previous: string;
    next: string;
    walle: string;
    walls: string;
  };
}

export interface BingImageConfig {
  idx: number;
  n: number;
  mkt: string;
  resolution?: '1920x1080' | 'UHD' | '3840x2160' | '2560x1440';
}

/**
 * Cloudflare ImgBed API Response Types
 */
export interface ImgBedUploadResponse {
  src: string;
}

export interface ImgBedUploadConfig {
  authCode?: string;
  serverCompress?: boolean;
  uploadChannel?: 'telegram' | 'cfr2' | 's3' | 'discord' | 'huggingface';
  channelName?: string;
  autoRetry?: boolean;
  uploadNameType?: 'default' | 'index' | 'origin' | 'short';
  returnFormat?: 'default' | 'full';
  uploadFolder?: string;
}

/**
 * Worker Environment Types
 */
export interface Env {
  IMG_BED_URL: string;
  IMG_BED_AUTH_CODE: string;
  IMG_BED_CHANNEL?: 'telegram' | 'cfr2' | 's3' | 'discord' | 'huggingface';
  BING_MARKET?: string;
  BING_RESOLUTION?: string;
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  TRIGGER_TOKEN?: string;
  DB?: D1Database;
}

/**
 * Logger Types
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}
