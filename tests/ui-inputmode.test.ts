import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { watchInputMode } from '@/ui/inputMode';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  delete document.documentElement.dataset.input;
});

describe('input mode', () => {
  it('is pointer after a touch or click and keys after a key press', () => {
    stop = watchInputMode();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.documentElement.dataset.input).toBe('pointer');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.documentElement.dataset.input).toBe('keys');
  });
  it('stops listening once stopped', () => {
    watchInputMode()();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.documentElement.dataset.input).toBeUndefined();
  });
  it('hides the focus ring only in pointer mode and never on fields', () => {
    const css = readFileSync('src/ui/styles/base.css', 'utf8');
    expect(css).toMatch(
      /html\[data-input='pointer'\] :is\(button, a, \[role='button'\], \[tabindex\]\):focus-visible \{\s*outline: none;/,
    );
    expect(css).not.toMatch(/data-input='pointer'\][^{]*(input|textarea|select)/);
  });
});
