import { describe, it, expect } from 'vitest';
import { Config } from '../src/modules/config';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    IMG_BED_URL: 'https://imgbed.example.com',
    IMG_BED_AUTH_CODE: 'secret-auth-code',
    IMG_BED_CHANNEL: 'telegram',
    BING_MARKET: 'en-US',
    BING_RESOLUTION: '1920x1080',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

describe('Config', () => {
  describe('validate', () => {
    it('passes when all required env vars are present', () => {
      const config = new Config(makeEnv());
      expect(() => config.validate()).not.toThrow();
    });

    it('throws when IMG_BED_URL is missing', () => {
      const config = new Config(makeEnv({ IMG_BED_URL: '' as string }));
      expect(() => config.validate()).toThrow(/IMG_BED_URL/);
    });

    it('throws when IMG_BED_AUTH_CODE is missing', () => {
      const config = new Config(makeEnv({ IMG_BED_AUTH_CODE: '' as string }));
      expect(() => config.validate()).toThrow(/IMG_BED_AUTH_CODE/);
    });

    it('throws when both required vars are missing, listing both', () => {
      const config = new Config(makeEnv({ IMG_BED_URL: '' as string, IMG_BED_AUTH_CODE: '' as string }));
      expect(() => config.validate()).toThrow(/IMG_BED_URL.*IMG_BED_AUTH_CODE|IMG_BED_AUTH_CODE.*IMG_BED_URL/);
    });

    it('throws on invalid BING_RESOLUTION', () => {
      const config = new Config(makeEnv({ BING_RESOLUTION: '9999x9999' }));
      expect(() => config.validate()).toThrow(/Invalid BING_RESOLUTION/);
    });

    it('accepts UHD as a valid resolution', () => {
      const config = new Config(makeEnv({ BING_RESOLUTION: 'UHD' }));
      expect(() => config.validate()).not.toThrow();
    });
  });

  describe('getters', () => {
    it('exposes the ImgBed URL', () => {
      const config = new Config(makeEnv({ IMG_BED_URL: 'https://imgbed.example.com' }));
      expect(config.imgBedUrl).toBe('https://imgbed.example.com');
    });

    it('builds an ImgBed config with defaults', () => {
      const config = new Config(makeEnv());
      expect(config.imgBedConfig).toMatchObject({
        authCode: 'secret-auth-code',
        uploadChannel: 'telegram',
        uploadFolder: 'bing-wallpapers',
      });
    });

    it('uses telegram as the default upload channel', () => {
      const env = makeEnv();
      delete env.IMG_BED_CHANNEL;
      const config = new Config(env);
      expect(config.imgBedConfig.uploadChannel).toBe('telegram');
    });

    it('builds a Bing config with defaults', () => {
      const config = new Config(makeEnv());
      expect(config.bingConfig).toMatchObject({
        idx: 0,
        n: 1,
        mkt: 'en-US',
        resolution: '1920x1080',
      });
    });

    it('uses en-US as the default market', () => {
      const env = makeEnv();
      delete env.BING_MARKET;
      const config = new Config(env);
      expect(config.bingConfig.mkt).toBe('en-US');
    });

    it('uses info as the default log level', () => {
      const env = makeEnv();
      delete env.LOG_LEVEL;
      const config = new Config(env);
      expect(config.logLevel).toBe('info');
    });

    it('exposes TRIGGER_TOKEN when set', () => {
      const config = new Config(makeEnv({ TRIGGER_TOKEN: 'my-token' }));
      expect(config.triggerToken).toBe('my-token');
    });

    it('returns undefined for TRIGGER_TOKEN when not set', () => {
      const config = new Config(makeEnv());
      expect(config.triggerToken).toBeUndefined();
    });

    it('returns undefined for db when D1 binding is not set', () => {
      const config = new Config(makeEnv());
      expect(config.db).toBeUndefined();
    });
  });

  describe('createBingConfig', () => {
    it('overrides specified fields while keeping defaults', () => {
      const config = new Config(makeEnv());
      const custom = config.createBingConfig({ idx: 3, n: 7 });
      expect(custom.idx).toBe(3);
      expect(custom.n).toBe(7);
      expect(custom.mkt).toBe('en-US'); // unchanged default
      expect(custom.resolution).toBe('1920x1080'); // unchanged default
    });
  });
});
