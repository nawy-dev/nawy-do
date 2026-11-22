import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(`src/ui/styles/${name}.css`, 'utf8');

describe('safe areas (ADR 0047)', () => {
  it('defines both from env() and the Capacitor variables, the larger winning', () => {
    const base = css('base');
    expect(base).toContain(
      '--safe-top: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px))',
    );
    expect(base).toContain(
      '--safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px))',
    );
  });
  it('keeps the header, tabs and side menu out from under the status bar', () => {
    const shell = css('shell');
    expect(shell).toMatch(/\.shell \{[^}]*padding-block-start: var\(--safe-top\)/);
    expect(shell).toMatch(
      /\.nav \{[^}]*position: sticky;[^}]*inset-block-start: var\(--safe-top\)/,
    );
    expect(shell).toMatch(/\.drawer \{[^}]*padding: calc\(0\.5rem \+ var\(--safe-top\)\)/);
  });
  it('uses no bare env() for the bottom edge any more', () => {
    for (const f of ['shell', 'details', 'feedback', 'tasks']) {
      expect(css(f)).not.toContain('env(safe-area-inset-bottom)');
    }
  });
});
