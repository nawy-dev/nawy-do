import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bars = vi.hoisted(() => ({ setStyle: vi.fn(() => Promise.resolve()) }));
vi.mock('@capacitor/core', () => ({
  SystemBars: bars,
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));

import { barStyle, watchSystemBars } from '@/app/native/systemBars';

describe('barStyle', () => {
  it('follows the phone while the theme is automatic', () => {
    expect(barStyle(null, true)).toBe('DARK');
    expect(barStyle(null, false)).toBe('LIGHT');
  });
  it('follows the app theme when one is chosen, whatever the phone does', () => {
    expect(barStyle('dark', false)).toBe('DARK');
    expect(barStyle('black', false)).toBe('DARK');
    expect(barStyle('light', true)).toBe('LIGHT');
  });
});

describe('watchSystemBars', () => {
  let dark = false;
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return dark;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sets the icons now and again when the theme changes', async () => {
    const stop = watchSystemBars();
    await vi.waitFor(() => expect(bars.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' }));
    document.documentElement.setAttribute('data-theme', 'black');
    await vi.waitFor(() => expect(bars.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' }));
    stop();
    bars.setStyle.mockClear();
    document.documentElement.setAttribute('data-theme', 'light');
    await new Promise((r) => setTimeout(r, 20));
    expect(bars.setStyle).not.toHaveBeenCalled();
  });
  it('never throws when the plugin fails', async () => {
    bars.setStyle.mockRejectedValueOnce(new Error('no bridge'));
    const stop = watchSystemBars();
    await new Promise((r) => setTimeout(r, 20));
    stop();
  });
});
