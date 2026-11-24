import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from '@/ui/tasks/useLongPress';

function Row({ onLong }: { onLong: () => void }) {
  const press = useLongPress(onLong);
  return <div data-testid="row" {...press} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hold = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('long press', () => {
  it('fires after half a second of holding still', () => {
    const onLong = vi.fn();
    const { getByTestId } = render(<Row onLong={onLong} />);
    fireEvent.pointerDown(getByTestId('row'), { clientX: 10, clientY: 10, pointerType: 'touch' });
    hold(600);
    expect(onLong).toHaveBeenCalledOnce();
  });
  it('is cancelled by the finger moving, even when another element has captured the pointer', () => {
    const onLong = vi.fn();
    const { getByTestId } = render(<Row onLong={onLong} />);
    fireEvent.pointerDown(getByTestId('row'), { clientX: 10, clientY: 10, pointerType: 'touch' });
    // A page swipe captures the pointer: the row never hears the move, the window does.
    fireEvent.pointerMove(document.body, { clientX: 70, clientY: 12 });
    hold(600);
    expect(onLong).not.toHaveBeenCalled();
  });
  it('is cancelled by the release, wherever it lands', () => {
    const onLong = vi.fn();
    const { getByTestId } = render(<Row onLong={onLong} />);
    fireEvent.pointerDown(getByTestId('row'), { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerUp(document.body);
    hold(600);
    expect(onLong).not.toHaveBeenCalled();
  });
  it('does not fire on a row that is gone (the list changed under the finger)', () => {
    const onLong = vi.fn();
    const { getByTestId, unmount } = render(<Row onLong={onLong} />);
    fireEvent.pointerDown(getByTestId('row'), { clientX: 10, clientY: 10, pointerType: 'touch' });
    unmount();
    hold(600);
    expect(onLong).not.toHaveBeenCalled();
  });
  it('tolerates a little drift', () => {
    const onLong = vi.fn();
    const { getByTestId } = render(<Row onLong={onLong} />);
    fireEvent.pointerDown(getByTestId('row'), { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerMove(document.body, { clientX: 14, clientY: 13 });
    hold(600);
    expect(onLong).toHaveBeenCalledOnce();
  });
});
