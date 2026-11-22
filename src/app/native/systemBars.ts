// The colour of the status and navigation bar icons inside the Android app (ADR 0047). The system
// picks light or dark icons from the PHONE's appearance, not from the app's theme: a dark app on a
// light phone would get dark icons on a dark bar. So the app tells the system what it is showing.

export type BarStyle = 'DARK' | 'LIGHT';

/**
 * `DARK` = light icons (for a dark page), `LIGHT` = dark icons. `attr` is the app's explicit theme
 * (`data-theme` on <html>), null while it follows the phone.
 */
export function barStyle(attr: string | null, systemDark: boolean): BarStyle {
  const dark = attr === 'dark' || attr === 'black' || (attr !== 'light' && systemDark);
  return dark ? 'DARK' : 'LIGHT';
}

async function apply(style: BarStyle): Promise<void> {
  try {
    // Wrapped: a Capacitor plugin object must never be what a promise resolves with.
    const { bars, styles } = await import('@capacitor/core').then((m) => ({
      bars: m.SystemBars,
      styles: m.SystemBarsStyle,
    }));
    await bars.setStyle({ style: style === 'DARK' ? styles.Dark : styles.Light });
  } catch {
    // The icons keep the system's choice; nothing else depends on this.
  }
}

/** Keeps the bar icons in step with the theme, now and on every change. Returns a stop function. */
export function watchSystemBars(): () => void {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => void apply(barStyle(root.getAttribute('data-theme'), media.matches));
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', update);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', update);
  };
}
