// Files and sharing inside the Android app (ADR 0046). The WebView has no browser download and no
// Web Share API, so a file is written to the app's cache and handed to the system share sheet
// ("Save to Files", Drive, messaging...). Plugins load only when asked: never in a browser.

// A Capacitor plugin object must never be what a promise resolves with (its proxy answers `then`):
// wrap the plugins in a plain object.
async function plugins() {
  const [fs, share] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  return { fs, share: share.Share };
}

/** Writes `text` to a file named `filename` and opens the share sheet for it. False if it failed or was cancelled. */
export async function shareNativeFile(filename: string, text: string): Promise<boolean> {
  try {
    const { fs, share } = await plugins();
    const written = await fs.Filesystem.writeFile({
      path: filename,
      data: text,
      directory: fs.Directory.Cache,
      encoding: fs.Encoding.UTF8,
    });
    await share.share({ title: filename, files: [written.uri] });
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet for text. False if it failed or was cancelled. */
export async function shareNativeText(title: string, text: string): Promise<boolean> {
  try {
    const { share } = await plugins();
    await share.share({ title, text });
    return true;
  } catch {
    return false;
  }
}

const SAVE_FOLDER = 'Nawy';

/**
 * Saves `text` on the phone, in Documents/Nawy, where the person finds it in the Files app (no share
 * sheet in between). Android 10 and older ask for storage permission first; newer ones need none.
 * Returns the folder to tell the person about, or null if it could not be written.
 */
export async function saveNativeFile(filename: string, text: string): Promise<string | null> {
  try {
    const { fs } = await plugins();
    const have = await fs.Filesystem.checkPermissions();
    if (have.publicStorage !== 'granted') {
      const asked = await fs.Filesystem.requestPermissions();
      if (asked.publicStorage !== 'granted') return null;
    }
    await fs.Filesystem.writeFile({
      path: `${SAVE_FOLDER}/${filename}`,
      data: text,
      directory: fs.Directory.Documents,
      encoding: fs.Encoding.UTF8,
      recursive: true,
    });
    return `Documents/${SAVE_FOLDER}`;
  } catch {
    return null;
  }
}
