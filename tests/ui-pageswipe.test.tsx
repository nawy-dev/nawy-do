import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePageSwipe } from '@/ui/shell/usePageSwipe';

const onStep = vi.fn();

function Surface({ onTap }: { onTap: () => void }) {
  const main = useRef<HTMLElement>(null);
  const page = useRef<HTMLDivElement>(null);
  usePageSwipe(main, page, { canStep: () => true, onStep, enabled: true });
  return (
    <main ref={main} data-testid="surface">
      <div ref={page}>
        <button type="button" onClick={onTap}>
          row
        </button>
      </div>
    </main>
  );
}

/** A pointer or click event with the fields the hook reads (jsdom has no PointerEvent). */
function fire(el: Element, type: string, at: { x?: number; y?: number; t: number }) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    clientX: { value: at.x ?? 0 },
    clientY: { value: at.y ?? 0 },
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
    timeStamp: { value: at.t },
  });
  el.dispatchEvent(e);
}

describe('page swipe', () => {
  it('swallows the click that follows a swipe, even when it arrives late', () => {
    const tap = vi.fn();
    const { getByText, getByTestId } = render(<Surface onTap={tap} />);
    const surface = getByTestId('surface');
    fire(surface, 'pointerdown', { x: 200, t: 1000 });
    fire(surface, 'pointermove', { x: 186, t: 1060 }); // 14px: past the lock, a swipe
    fire(surface, 'pointerup', { x: 186, t: 1080 });
    fire(getByText('row'), 'click', { t: 1330 }); // 250ms after the release
    expect(tap).not.toHaveBeenCalled();
  });
  it('lets a plain tap through, and a tap after a swipe once a new touch starts', () => {
    const tap = vi.fn();
    const { getByText, getByTestId } = render(<Surface onTap={tap} />);
    const surface = getByTestId('surface');
    fire(surface, 'pointerdown', { x: 200, t: 100 });
    fire(surface, 'pointerup', { x: 200, t: 140 });
    fire(getByText('row'), 'click', { t: 150 });
    expect(tap).toHaveBeenCalledTimes(1);
    fire(surface, 'pointerdown', { x: 200, t: 2000 });
    fire(surface, 'pointermove', { x: 150, t: 2040 });
    fire(surface, 'pointerup', { x: 150, t: 2060 });
    fire(surface, 'pointerdown', { x: 200, t: 2200 }); // the next touch, within the quiet window
    fire(surface, 'pointerup', { x: 200, t: 2230 });
    fire(getByText('row'), 'click', { t: 2240 });
    expect(tap).toHaveBeenCalledTimes(2);
  });
});
