// Text shared from another Android app (ADR 0048). The phone hands the app an ACTION_SEND intent;
// MainActivity (tools/android/patch_main_activity.py) turns it into a link `nawydo://share?...`, which
// Capacitor's App plugin reports as the launch link (app was closed) or an opened link (app running).
// The query is the same one the PWA's share_target sends, so `parseLaunch` reads both.
import { parseLaunch, type Launch } from '@/core/model';

/**
 * The launch parameters inside a `nawydo://` link, or null for any other link. `nawydo://new` is
 * the «new intention» shortcut on the app icon.
 */
export function launchFromUrl(url: string): Launch | null {
  if (!url.startsWith('nawydo://')) return null;
  if (url.startsWith('nawydo://new')) return { newTask: true, shared: undefined };
  const at = url.indexOf('?');
  return parseLaunch(at < 0 ? '' : url.slice(at));
}

/** The same shared text can be reported twice (launch link, then opened link): only the first counts. */
const SAME_LINK_MS = 3000;

/**
 * Calls `onLaunch` for every link that opens the app from now on, and for the one it was launched
 * with. Returns the function that stops listening. Never throws: without the plugin nothing happens.
 */
export async function watchNativeLaunch(
  onLaunch: (launch: Launch) => void,
  now: () => number,
): Promise<() => void> {
  try {
    const { App } = await import('@capacitor/app');
    let last = { url: '', at: -SAME_LINK_MS };
    const handle = (url: string | undefined) => {
      const launch = url === undefined ? null : launchFromUrl(url);
      if (!launch || (url === last.url && now() - last.at < SAME_LINK_MS)) return;
      last = { url: url ?? '', at: now() };
      onLaunch(launch);
    };
    const listener = await App.addListener('appUrlOpen', (e) => handle(e.url));
    void App.getLaunchUrl().then(
      (l) => handle(l?.url),
      () => undefined,
    );
    return () => void listener.remove();
  } catch {
    return () => undefined;
  }
}
