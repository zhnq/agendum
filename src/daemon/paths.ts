import { dirname, join } from 'node:path';

const sourceRoot = join(import.meta.dir, '..', '..');

function executableRoot(): string | null {
  const exe = process.execPath;
  if (!exe || /[\\/]bun(\.exe)?$/i.test(exe)) return null;
  return dirname(exe);
}

export const APP_ROOT = process.env.AGENDUM_ROOT || executableRoot() || sourceRoot;
export const DATA_DIR = process.env.AGENDUM_DATA_DIR || join(APP_ROOT, 'data');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const WEB_DIST = process.env.AGENDUM_WEB_DIST || join(APP_ROOT, 'web', 'dist');
