import { useEffect, useRef } from 'react';
import { isNativeApp } from './env';
import { watchNativeLaunch } from './launchLinks';

/**
 * In the Android app: text shared from another app (the share sheet → Nawy To Do) arrives here,
 * both when the app was closed and when it is already open. `onShared` gets the one-line title.
 */
export function useNativeLaunch(onShared: (text: string) => void, now: () => number): void {
  const latest = useRef(onShared);
  latest.current = onShared;
  useEffect(() => {
    if (!isNativeApp()) return;
    let stopped = false;
    let stop: (() => void) | undefined;
    void watchNativeLaunch((launch) => {
      if (launch.shared !== undefined) latest.current(launch.shared);
    }, now).then((off) => {
      if (stopped) off();
      else stop = off;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }, [now]);
}
