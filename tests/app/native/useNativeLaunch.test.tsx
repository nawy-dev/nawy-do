import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Launch } from '@/core/model';

const links = vi.hoisted(() => ({
  push: undefined as undefined | ((l: Launch) => void),
  stop: vi.fn(),
}));
vi.mock('@/app/native/launchLinks', () => ({
  watchNativeLaunch: vi.fn((cb: (l: Launch) => void) => {
    links.push = cb;
    return Promise.resolve(links.stop);
  }),
}));

import { useNativeLaunch } from '@/app/native/useNativeLaunch';

const inApp = (on: boolean) => {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.Capacitor = { isNativePlatform: () => true };
  else delete w.Capacitor;
};
afterEach(() => {
  inApp(false);
  links.push = undefined;
  links.stop.mockClear();
});

describe('useNativeLaunch', () => {
  it('does nothing in a browser', () => {
    renderHook(() => useNativeLaunch(vi.fn(), () => 0));
    expect(links.push).toBeUndefined();
  });
  it('hands shared text to the latest callback and stops listening on unmount', async () => {
    inApp(true);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => useNativeLaunch(cb, () => 0), {
      initialProps: { cb: first },
    });
    await Promise.resolve();
    rerender({ cb: second });
    links.push?.({ newTask: false, shared: 'خبز' });
    links.push?.({ newTask: true, shared: undefined }); // nothing to add
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith('خبز');
    unmount();
    expect(links.stop).toHaveBeenCalledOnce();
  });
  it('counts the icon shortcut taps so each one opens the add sheet', async () => {
    inApp(true);
    const { result } = renderHook(() => useNativeLaunch(vi.fn(), () => 0));
    await Promise.resolve();
    expect(result.current).toBe(0);
    act(() => links.push?.({ newTask: true, shared: undefined }));
    act(() => links.push?.({ newTask: true, shared: undefined }));
    expect(result.current).toBe(2);
  });
});
