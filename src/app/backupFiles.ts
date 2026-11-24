import type { BackupApi } from '@/features/backup';
import { downloadText, shareText } from './files';
import { isNativeApp } from './native/env';
import { saveNativeFile } from './native/share';

/**
 * «Download the backup»: the browser's download, or inside the Android app a file saved on the
 * phone (Documents/Nawy). Tells the person what happened. True if the file went out.
 */
export async function downloadBackup(backup: BackupApi, filename: string): Promise<boolean> {
  const text = await backup.exportJson();
  if (!isNativeApp()) {
    downloadText(filename, text);
    backup.report({ kind: 'exported' });
    return true;
  }
  const folder = await saveNativeFile(filename, text);
  backup.report(folder ? { kind: 'saved', folder } : { kind: 'error', code: 'save-failed' });
  return folder !== null;
}

/** «Share the backup»: the system sheet (Drive, messages, Files...). True if it was shared. */
export async function shareBackup(backup: BackupApi, filename: string): Promise<boolean> {
  const shared = await shareText(filename, await backup.exportJson());
  if (shared) backup.report({ kind: 'shared' });
  return shared;
}
