import { afterEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ downloadText: vi.fn(), shareText: vi.fn() }));
const native = vi.hoisted(() => ({ saveNativeFile: vi.fn() }));
vi.mock('@/app/files', () => files);
vi.mock('@/app/native/share', () => native);

import { downloadBackup, shareBackup } from '@/app/backupFiles';
import type { BackupApi } from '@/features/backup';

const api = () =>
  ({ exportJson: vi.fn().mockResolvedValue('{"a":1}'), report: vi.fn() }) as unknown as BackupApi;
const inApp = (on: boolean) => {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.Capacitor = { isNativePlatform: () => true };
  else delete w.Capacitor;
};
afterEach(() => {
  inApp(false);
  vi.clearAllMocks();
});

describe('backup files', () => {
  it('download in a browser is the browser download', async () => {
    const backup = api();
    expect(await downloadBackup(backup, 'b.json')).toBe(true);
    expect(files.downloadText).toHaveBeenCalledWith('b.json', '{"a":1}');
    expect(backup.report).toHaveBeenCalledWith({ kind: 'exported' });
  });
  it('download in the Android app saves on the phone, not through the share sheet', async () => {
    inApp(true);
    native.saveNativeFile.mockResolvedValue('Documents/Nawy');
    const backup = api();
    expect(await downloadBackup(backup, 'b.json')).toBe(true);
    expect(native.saveNativeFile).toHaveBeenCalledWith('b.json', '{"a":1}');
    expect(files.shareText).not.toHaveBeenCalled();
    expect(backup.report).toHaveBeenCalledWith({ kind: 'saved', folder: 'Documents/Nawy' });
  });
  it('says so when the phone refuses the file', async () => {
    inApp(true);
    native.saveNativeFile.mockResolvedValue(null);
    const backup = api();
    expect(await downloadBackup(backup, 'b.json')).toBe(false);
    expect(backup.report).toHaveBeenCalledWith({ kind: 'error', code: 'save-failed' });
  });
  it('share goes to the share sheet and is reported only when it went out', async () => {
    const backup = api();
    files.shareText.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await shareBackup(backup, 'b.json')).toBe(true);
    expect(backup.report).toHaveBeenCalledWith({ kind: 'shared' });
    backup.report = vi.fn();
    expect(await shareBackup(backup, 'b.json')).toBe(false);
    expect(backup.report).not.toHaveBeenCalled();
  });
});
