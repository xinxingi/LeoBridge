import { mkdir, mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeError } from '../core/errors.ts';

/** Only known filesystem failures are translated. Never log raw errors or state contents. */
export async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof BridgeError) throw error;
    const errno = (error as NodeJS.ErrnoException | null)?.code;
    const label = '数据目录';
    const identity = `UID/GID ${process.getuid?.() ?? '未知'}/${process.getgid?.() ?? '未知'}`;
    let failure: BridgeError;
    switch (errno) {
      case 'EACCES': case 'EPERM':
        failure = new BridgeError('STORAGE_PERMISSION', 503, `${label}权限不足，运行用户为 ${identity}。请检查挂载目录的所有者及读写权限；Docker 默认使用 1000:1000。修复后重试，勿删除数据。`); break;
      case 'EROFS':
        failure = new BridgeError('STORAGE_READ_ONLY', 503, `${label}所在挂载为只读。请将该目录设为可写；Docker 应用根文件系统可继续只读。`); break;
      case 'ENOSPC': case 'EDQUOT':
        failure = new BridgeError('STORAGE_FULL', 503, `${label}所在磁盘空间、inode 或配额不足。请检查磁盘用量并释放空间，勿删除业务数据。`); break;
      case 'ENOTDIR': case 'EISDIR':
        failure = new BridgeError('STORAGE_PATH', 503, `${label}结构不正确。请核对挂载路径；数据根路径应为目录，state.json 应为文件。`); break;
      case 'EIO':
        failure = new BridgeError('STORAGE_IO', 503, `${label}读写失败。请检查宿主磁盘和挂载状态。`); break;
      default: throw error;
    }
    console.error(`LeoBridge storage [${failure.code}] area=data errno=${errno}: ${failure.message}`);
    throw failure;
  }
}

/** Exercise the operations required by state commits, using only disposable files. */
async function probe(directory: string): Promise<void> {
  const scratch = await mkdtemp(join(directory, '.leobridge-check-'));
  try {
    const first = join(scratch, 'write'), second = join(scratch, 'renamed');
    await writeFile(first, 'storage-check', { flag: 'wx', mode: 0o600 });
    await rename(first, second);
    if (await readFile(second, 'utf8') !== 'storage-check') throw new BridgeError('STORAGE_IO', 503, '存储读写校验失败，请检查磁盘及挂载状态。');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function checkStorage(data: string): Promise<void> {
  await storageOperation(async () => {
    await mkdir(data, { recursive: true, mode: 0o700 });
    await probe(data);
  });
}
