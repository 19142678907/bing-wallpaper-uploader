import { describe, it, expect } from 'vitest';
import { formatDate, parseBingDate, generateFilename } from '../src/modules/utils';
import type { BingImage } from '../src/types';

describe('formatDate', () => {
  it('formats a date as YYYYMMDD', () => {
    const date = new Date(2025, 5, 27); // June 27, 2025 (month is 0-indexed)
    expect(formatDate(date)).toBe('20250627');
  });

  it('pads single-digit months and days with leading zeros', () => {
    const date = new Date(2025, 0, 1); // January 1, 2025
    expect(formatDate(date)).toBe('20250101');
  });

  it('handles December 31 correctly', () => {
    const date = new Date(2025, 11, 31); // December 31, 2025
    expect(formatDate(date)).toBe('20251231');
  });
});

describe('parseBingDate', () => {
  it('parses a YYYYMMDD string into a Date', () => {
    const date = parseBingDate('20250627');
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(5); // June (0-indexed)
    expect(date.getDate()).toBe(27);
  });

  it('round-trips with formatDate', () => {
    const original = new Date(2025, 5, 27);
    const formatted = formatDate(original);
    const parsed = parseBingDate(formatted);
    expect(parsed.getFullYear()).toBe(original.getFullYear());
    expect(parsed.getMonth()).toBe(original.getMonth());
    expect(parsed.getDate()).toBe(original.getDate());
  });
});

describe('generateFilename', () => {
  const baseImage: Pick<BingImage, 'startdate' | 'title'> = {
    startdate: '20250627',
    title: 'Sunrise Over the Alps',
  };

  it('generates a filename with date, title, and resolution', () => {
    const filename = generateFilename(baseImage, '1920x1080');
    expect(filename).toBe('bing_20250627_Sunrise_Over_the_Alps_1920x1080.jpg');
  });

  it('strips non-alphanumeric characters from the title', () => {
    const image: Pick<BingImage, 'startdate' | 'title'> = {
      startdate: '20250627',
      title: 'Hello, World! @#$%',
    };
    const filename = generateFilename(image, 'UHD');
    // Consecutive invalid characters collapse into one separator for readable filenames.
    expect(filename).toBe('bing_20250627_Hello_World_UHD.jpg');
  });

  it('falls back to "wallpaper" when title is empty', () => {
    const image: Pick<BingImage, 'startdate' | 'title'> = {
      startdate: '20250627',
      title: '',
    };
    const filename = generateFilename(image, '1920x1080');
    expect(filename).toBe('bing_20250627_wallpaper_1920x1080.jpg');
  });

  it('truncates long titles to 50 characters at word boundary', () => {
    const longTitle = 'A'.repeat(100);
    const image: Pick<BingImage, 'startdate' | 'title'> = {
      startdate: '20250627',
      title: longTitle,
    };
    const filename = generateFilename(image, '1920x1080');
    // All 'A's with no underscores — keeps full 50 chars.
    expect(filename).toBe(`bing_20250627_${'A'.repeat(50)}_1920x1080.jpg`);
  });

  it('truncates at word boundary when underscores exist', () => {
    const longTitle = 'Hello_World_From_Bing_Wallpaper_Service_2025_AdditionalText';
    const image: Pick<BingImage, 'startdate' | 'title'> = {
      startdate: '20250627',
      title: longTitle,
    };
    const filename = generateFilename(image, '1920x1080');
    // Should truncate at or before 50 chars, ending at a word boundary (underscore)
    expect(filename).toMatch(/^bing_20250627_.+_1920x1080\.jpg$/);
    const titlePart = filename.replace(/bing_20250627_/, '').replace(/_1920x1080\.jpg$/, '');
    expect(titlePart.length).toBeLessThanOrEqual(50);
  });
});
