import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10; // px the finger may drift before it is a scroll, not a press

/**
 * Holding a row still for half a second starts selecting with that row picked. Moving first (a
 * scroll or a page swipe) cancels it. The release after a long press must not also «click» the text
 * under the finger, and the system's text menu must not open.
 *
 * The movement and the release are watched on the window, not on the row: a page swipe captures the
 * pointer, after which the row never hears the finger move or lift. Watching the row only let a
 * quick swipe start selecting half a second later (found on an Android emulator with real touch).
 */
export function useLongPress(onLongPress: (() => void) | undefined) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef(0);
  const swallowClick = useRef(false);
  const watching = useRef<(() => void) | null>(null);
  const stop = () => {
    window.clearTimeout(timer.current);
    start.current = null;
    watching.current?.();
    watching.current = null;
  };
  // A swipe re-renders the list under the pending press: it must not fire on a row that is gone.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      watching.current?.();
    },
    [],
  );

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!onLongPress || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // A press on the re-order handle belongs to the drag library.
      if ((e.target as Element).closest('[data-no-press]')) return;
      stop();
      const from = { x: e.clientX, y: e.clientY };
      start.current = from;
      const move = (m: globalThis.PointerEvent) => {
        if (Math.hypot(m.clientX - from.x, m.clientY - from.y) > MOVE_TOLERANCE) stop();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
      watching.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      timer.current = window.setTimeout(() => {
        stop();
        swallowClick.current = true;
        navigator.vibrate?.(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onContextMenu(e: MouseEvent<HTMLElement>) {
      if (onLongPress) e.preventDefault();
    },
    onClickCapture(e: MouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
