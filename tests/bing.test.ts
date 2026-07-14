import { describe, it, expect } from 'vitest';
import { BingClient } from '../src/modules/bing';
import { Logger } from '../src/modules/utils';
import type { BingImage } from '../src/types';

const logger = new Logger('error'); // quiet logs during tests

function makeImage(overrides: Partial<BingImage> = {}): BingImage {
  return {
    startdate: '20250627',
    fullstartdate: '202506271200',
    enddate: '20250628',
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

describe('BingClient.buildImageUrl', () => {
  const client = new BingClient(logger);

  it('builds a URL from urlbase when present', () => {
    const image = makeImage();
    const url = client.buildImageUrl(image, 'UHD');
    expect(url).toBe('https://www.bing.com/th?id=OHR.AlpsSunrise_EN-US1234567890_UHD.jpg');
  });

  it('appends the requested resolution', () => {
    const image = makeImage();
    expect(client.buildImageUrl(image, '1920x1080')).toContain('_1920x1080.jpg');
    expect(client.buildImageUrl(image, '3840x2160')).toContain('_3840x2160.jpg');
  });

  it('derives the base from url when urlbase is missing', () => {
    const image = makeImage({
      urlbase: '',
      url: '/th?id=OHR.AlpsSunrise_EN-US1234567890_1920x1080.jpg',
    });
    const url = client.buildImageUrl(image, 'UHD');
    // The regex strips the trailing _1920x1080.jpg, leaving the base, then re-appends _UHD.jpg
    expect(url).toBe('https://www.bing.com/th?id=OHR.AlpsSunrise_EN-US1234567890_UHD.jpg');
  });

  it('falls back to stripping just the extension when url has no resolution suffix', () => {
    const image = makeImage({
      urlbase: '',
      url: '/th?id=OHR.SomeImage_EN-US1234567890.jpg',
    });
    const url = client.buildImageUrl(image, '1920x1080');
    expect(url).toBe('https://www.bing.com/th?id=OHR.SomeImage_EN-US1234567890_1920x1080.jpg');
  });

  it('always uses the bing.com host', () => {
    const image = makeImage();
    const url = client.buildImageUrl(image, 'UHD');
    expect(url.startsWith('https://www.bing.com/')).toBe(true);
    expect(url.endsWith('.jpg')).toBe(true);
  });
});
