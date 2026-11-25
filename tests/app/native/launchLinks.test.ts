import { beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
  listener: undefined as undefined | ((e: { url: string }) => void),
  remove: vi.fn(),
  launchUrl: undefined as undefined | { url: string },
  fail: false,
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_: string, cb: (e: { url: string }) => void) => {
      if (app.fail) return Promise.reject(new Error('no plugin'));
      app.listener = cb;
      return Promise.resolve({ remove: app.remove });
    }),
    getLaunchUrl: vi.fn(() => Promise.resolve(app.launchUrl)),
  },
}));

import { launchFromUrl, watchNativeLaunch } from '@/app/native/launchLinks';

beforeEach(() => {
  app.listener = undefined;
  app.launchUrl = undefined;
  app.fail = false;
  app.remove.mockClear();
});

describe('launchFromUrl', () => {
  it('reads the shared text out of a nawydo link', () => {
    const l = launchFromUrl(
      'nawydo://share?share_title=%D8%B9%D9%86%D9%88%D8%A7%D9%86&share_text=https%3A%2F%2Fa.b%2Fx',
    );
    expect(l?.shared).toBe('عنوان https://a.b/x');
  });
  it('reads the icon shortcut as a request for the add sheet', () => {
    expect(launchFromUrl('nawydo://new')).toEqual({ newTask: true, shared: undefined });
  });
  it('ignores other links and links with nothing shared', () => {
    expect(launchFromUrl('https://do.nawy.app/?share_text=x')).toBeNull();
    expect(launchFromUrl('nawydo://share')?.shared).toBeUndefined();
  });
});

describe('watchNativeLaunch', () => {
  it('reports the launch link and links opened while running, once each', async () => {
    app.launchUrl = { url: 'nawydo://share?share_text=first' };
    const seen: (string | undefined)[] = [];
    let t = 0;
    const stop = await watchNativeLaunch(
      (l) => seen.push(l.shared),
      () => t,
    );
    await Promise.resolve();
    app.listener?.({ url: 'nawydo://share?share_text=first' }); // the same link again, at once
    expect(seen).toEqual(['first']);
    t = 10_000;
    app.listener?.({ url: 'nawydo://share?share_text=second' });
    app.listener?.({ url: 'https://elsewhere.example/' });
    expect(seen).toEqual(['first', 'second']);
    stop();
    expect(app.remove).toHaveBeenCalledOnce();
  });
  it('does nothing, without throwing, when the plugin is not there', async () => {
    app.fail = true;
    const stop = await watchNativeLaunch(
      () => {
        throw new Error('unexpected');
      },
      () => 0,
    );
    expect(() => stop()).not.toThrow();
  });
});
