import { dirname, join } from 'node:path';

const sourceRoot = join(import.meta.dir, '..', '..');

function executableRoot(): string | null {
  const exe = process.execPath;
  if (!exe || /[\\/]bun(\.exe)?$/i.test(exe)) return null;
  return dirname(exe);
}

/** true = 以 bun build --compile 出的 agendum-daemon.exe 运行（安装版）；false = 源码 bun run */
export const IS_COMPILED = executableRoot() !== null;
export const APP_ROOT = process.env.AGENDUM_ROOT || executableRoot() || sourceRoot;
export const DATA_DIR = process.env.AGENDUM_DATA_DIR || join(APP_ROOT, 'data');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const WEB_DIST = process.env.AGENDUM_WEB_DIST || join(APP_ROOT, 'web', 'dist');
