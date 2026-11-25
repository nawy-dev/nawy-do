import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScreenState } from '@/ui/shell/useScreenState';

describe('add sheet requests', () => {
  it('opens at start when asked to', () => {
    expect(renderHook(() => useScreenState(true)).result.current.adding).toBe(true);
    expect(renderHook(() => useScreenState(false)).result.current.adding).toBe(false);
  });
  it('opens each time the icon shortcut asks while the app runs', () => {
    const { result, rerender } = renderHook(({ n }) => useScreenState(false, n), {
      initialProps: { n: 0 },
    });
    expect(result.current.adding).toBe(false);
    rerender({ n: 1 });
    expect(result.current.adding).toBe(true);
    act(() => result.current.setAdding(false));
    rerender({ n: 2 });
    expect(result.current.adding).toBe(true);
  });
});
