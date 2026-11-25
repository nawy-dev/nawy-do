import { useEffect, useRef, useState } from 'react';
import { isNativeApp } from './env';
import { watchNativeLaunch } from './launchLinks';

/**
 * In the Android app, links that open the app arrive here, both when it was closed and when it is
 * already open: text shared from another app (`onShared` gets the one-line title) and the «new
 * intention» shortcut on the icon. Returns how many times the shortcut asked for the add sheet;
 * a change means «open it now».
 */
export function useNativeLaunch(onShared: (text: string) => void, now: () => number): number {
  const latest = useRef(onShared);
  latest.current = onShared;
  const [newRequests, setNewRequests] = useState(0);
  useEffect(() => {
    if (!isNativeApp()) return;
    let stopped = false;
    let stop: (() => void) | undefined;
    void watchNativeLaunch((launch) => {
      if (launch.shared !== undefined) latest.current(launch.shared);
      else if (launch.newTask) setNewRequests((n) => n + 1);
    }, now).then((off) => {
      if (stopped) off();
      else stop = off;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }, [now]);
  return newRequests;
}
