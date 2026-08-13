import type { BingResponse, BingImage, BingImageConfig } from '../types';
import { Logger, retryWithBackoff, FetchError } from './utils';

/**
 * Bing Wallpaper API module
 * Handles fetching wallpaper information from Bing
 */
export class BingClient {
  private logger: Logger;
  private readonly BING_API_BASE = 'https://www.bing.com/HPImageArchive.aspx';

  private readonly FETCH_TIMEOUT_MS = 10_000;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Fetch Bing wallpaper metadata
   * @param config - Configuration for the fetch
   * @returns Bing image data
   */
  async fetchWallpaper(config: BingImageConfig): Promise<BingImage> {
    this.logger.info('Fetching Bing wallpaper', { config });

    try {
      const response = await retryWithBackoff(() => this.fetchFromAPI({ ...config, n: 1 }), { onRetry: (err, attempt) => this.logger.warn('Fetch attempt ' + attempt + ' failed, retrying', { error: String(err), attempt }) });
      const image = Array.isArray(response) ? response[0] : response;

      this.logger.info('Successfully fetched wallpaper metadata', {
        url: image.url,
        copyright: image.copyright
      });
      return image;
    } catch (error) {
      this.logger.error('Failed to fetch Bing wallpaper', { error: String(error) });
      throw error;
    }
  }

  /**
   * Download the wallpaper image as ArrayBuffer
   * @param imageUrl - Full URL of the image
   * @returns Image data as ArrayBuffer
   */
  async downloadImage(imageUrl: string): Promise<ArrayBuffer> {
    this.logger.info('Downloading wallpaper image', { url: imageUrl });

    try {
      // Use fetchWithRetry for resilience against transient network errors
      const arrayBuffer = await retryWithBackoff(async () => {
        const response = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
        });

        if (!response.ok) {
          throw new FetchError(
            `Failed to download image: ${response.statusText}`,
            response.status,
            await response.text()
          );
        }

        return await response.arrayBuffer();
      });

      this.logger.info('Successfully downloaded image', {
        size: arrayBuffer.byteLength,
        url: imageUrl
      });

      return arrayBuffer;
    } catch (error) {
      this.logger.error('Failed to download image', { url: imageUrl, error: String(error) });
      throw error;
    }
  }

  /**
   * Build full image URL from Bing API response
   * @param image - Bing image data
   * @param resolution - Desired resolution
   * @returns Full image URL
   */
  buildImageUrl(image: BingImage, resolution: string): string {
    // Use urlbase if available, otherwise construct from url
    let baseUrl: string;

    if (image.urlbase) {
      baseUrl = image.urlbase;
    } else {
      // Extract base from url (remove resolution and extension)
      const match = image.url.match(/^(.*?)(?:_\d+x\d+)?\.(jpg|png)$/i);
      baseUrl = match ? match[1] : image.url.replace(/\.(jpg|png)$/i, '');
    }

    const fullUrl = `https://www.bing.com${baseUrl}_${resolution}.jpg`;
    this.logger.debug('Built image URL', { fullUrl, resolution });

    return fullUrl;
  }

  /**
   * Fetch multiple wallpapers
   * @param n - Number of wallpapers to fetch
   * @param config - Base configuration
   * @returns Array of Bing image data
   */
  async fetchMultipleWallpapers(n: number, config: BingImageConfig): Promise<BingImage[]> {
    this.logger.info(`Fetching ${n} wallpapers`);

    const images: BingImage[] = [];
    const maxN = Math.min(n, 8); // Bing API limit is 8

    if (maxN !== n) {
      this.logger.warn(`Requested ${n} wallpapers but max is 8, fetching ${maxN}`, { requested: n, actual: maxN });
    }

    try {
      const response = await retryWithBackoff(() => this.fetchFromAPI({ ...config, n: maxN }), { onRetry: (err, attempt) => this.logger.warn('Fetch attempt ' + attempt + ' failed, retrying', { error: String(err), attempt }) });

      if (Array.isArray(response)) {
        images.push(...response);
      } else {
        images.push(response);
      }

      this.logger.info(`Successfully fetched ${images.length} wallpapers`);
      return images;
    } catch (error) {
      this.logger.error('Failed to fetch multiple wallpapers', { error: String(error) });
      throw error;
    }
  }

  /**
   * Internal method to fetch from Bing API
   */
  private async fetchFromAPI(config: BingImageConfig): Promise<BingImage | BingImage[]> {
    const params = new URLSearchParams({
      format: 'js',
      idx: String(config.idx),
      n: String(config.n),
      mkt: config.mkt
    });
    const url = `${this.BING_API_BASE}?${params}`;

    this.logger.debug('Fetching from Bing API', { url });

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new FetchError(
        `Bing API request failed: ${response.statusText}`,
        response.status,
        await response.text()
      );
    }

    const data: BingResponse = await response.json();

    if (!data.images || data.images.length === 0) {
      throw new Error('No images returned from Bing API');
    }

    // Return single image if n=1, otherwise return array
    return config.n === 1 ? data.images[0] : data.images;
  }
}
