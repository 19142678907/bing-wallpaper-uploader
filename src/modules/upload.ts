import type { ImgBedUploadConfig, ImgBedUploadResponse } from '../types';
import { Logger, UploadError, retryWithBackoff, sleep } from './utils';

/**
 * Detect the MIME type of an image from its binary signature (magic bytes).
 */
function detectImageMimeType(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data).slice(0, 4);
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
  return 'application/octet-stream';
}

type UploadMultipleResult =
  | { filename: string; imageUrl: string; success: true }
  | { filename: string; error: string; success: false };

/**
 * Cloudflare ImgBed Upload module
 * Handles uploading images to Cloudflare ImgBed
 */
export class ImgBedClient {
  private baseUrl: string;
  private logger: Logger;
  private readonly FETCH_TIMEOUT_MS = 30_000;

  constructor(baseUrl: string, logger: Logger) {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    this.baseUrl = normalizedUrl.endsWith('/upload')
      ? normalizedUrl.slice(0, -'/upload'.length)
      : normalizedUrl;
    this.logger = logger;
  }

  /**
   * Upload an image to ImgBed
   * @param imageData - Image data as ArrayBuffer
   * @param filename - Original filename
   * @param config - Upload configuration
   * @returns Upload result with image URL
   */
  async upload(
    imageData: ArrayBuffer,
    filename: string,
    config: ImgBedUploadConfig
  ): Promise<string> {
    this.logger.info('Uploading image to ImgBed', {
      filename,
      size: imageData.byteLength,
      channel: config.uploadChannel
    });

    try {
      // Build URL with query parameters
      const url = this.buildUploadUrl(config);
      this.logger.debug('Building upload URL');

      // Create FormData
      const formData = new FormData();
      const contentType = detectImageMimeType(imageData);
      const blob = new Blob([imageData], { type: contentType });
      formData.append('file', blob, filename);

      // Upload with retry logic
      const result = await retryWithBackoff(() => this.performUpload(url, formData), { onRetry: (err, attempt) => this.logger.warn('Upload attempt ' + attempt + ' failed, retrying', { error: String(err), attempt }) });

      const imageUrl = this.extractImageUrl(result);
      this.logger.info('Successfully uploaded image', {
        filename,
        imageUrl,
        channel: config.uploadChannel
      });

      return imageUrl;
    } catch (error) {
      this.logger.error('Failed to upload image', {
        filename,
        error: String(error),
        channel: config.uploadChannel
      });
      throw error;
    }
  }

  /**
   * Build upload URL with query parameters
   */
  private buildUploadUrl(config: ImgBedUploadConfig): string {
    const params = new URLSearchParams();

    if (config.authCode) {
      params.append('authCode', config.authCode);
    }
    if (config.uploadChannel) {
      params.append('uploadChannel', config.uploadChannel);
    }
    if (config.channelName) {
      params.append('channelName', config.channelName);
    }
    if (config.uploadFolder) {
      params.append('uploadFolder', config.uploadFolder);
    }
    if (config.uploadNameType) {
      params.append('uploadNameType', config.uploadNameType);
    }
    if (config.returnFormat) {
      params.append('returnFormat', config.returnFormat);
    }
    if (config.serverCompress !== undefined) {
      params.append('serverCompress', String(config.serverCompress));
    }
    if (config.autoRetry !== undefined) {
      params.append('autoRetry', String(config.autoRetry));
    }

    const uploadUrl = `${this.baseUrl}/upload`;

    const queryString = params.toString();
    return queryString ? `${uploadUrl}?${queryString}` : uploadUrl;
  }

  /**
   * Perform the actual upload request
   */
  private async performUpload(url: string, formData: FormData): Promise<ImgBedUploadResponse[]> {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new UploadError(
        `Upload failed: ${response.statusText}`,
        response.status,
        responseText
      );
    }

    const result = await response.json();

    if (!Array.isArray(result) || result.length === 0 || !result[0].src) {
      throw new UploadError('Invalid upload response format', response.status, JSON.stringify(result));
    }

    return result as ImgBedUploadResponse[];
  }

  /**
   * Extract image URL from response
   */
  private extractImageUrl(result: ImgBedUploadResponse[]): string {
    // Default format: /file/id
    if (result[0].src.startsWith('/file/')) {
      // Return full URL
      return `${this.baseUrl.replace(/\/$/, '')}${result[0].src}`;
    }
    // Return as-is if it's already a full URL
    return result[0].src;
  }

  /**
   * Upload multiple images in parallel
   * @param images - Array of image data with filenames
   * @param config - Upload configuration
   * @returns Per-image upload results in the same order as the input images
   */
  async uploadMultiple(
    images: Array<{ data: ArrayBuffer; filename: string }>,
    config: ImgBedUploadConfig,
    concurrency: number = 3
  ): Promise<UploadMultipleResult[]> {
    this.logger.info(`Uploading ${images.length} images with concurrency ${concurrency}`);

    const results: UploadMultipleResult[] = [];

    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);

      const uploadPromises = batch.map(async ({ data, filename }): Promise<UploadMultipleResult> => {
        try {
          const url = await this.upload(data, filename, config);
          return { filename, imageUrl: url, success: true };
        } catch (error) {
          const uploadError = error instanceof Error ? error : new UploadError(String(error));
          return { filename, error: uploadError.message, success: false };
        }
      });

      const batchResults = await Promise.all(uploadPromises);

      for (const result of batchResults) {
        results.push(result);

        if (!result.success) {
          this.logger.error(`Failed to upload ${result.filename}`, { error: String(result.error) });
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + concurrency < images.length) {
        await sleep(500);
      }
    }

    const failedResults = results.filter(result => !result.success);

    this.logger.info(`Upload complete: ${results.length - failedResults.length} successful, ${failedResults.length} failed`, {
      successful: results.length - failedResults.length,
      failed: failedResults.length
    });

    if (failedResults.length > 0) {
      // Partial success - still return results but log warnings
      this.logger.warn(`Some uploads failed: ${failedResults.length} out of ${images.length}`, {
        failed: failedResults.map(e => e.filename)
      });
    }

    return results;
  }
}
