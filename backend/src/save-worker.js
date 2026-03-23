import { parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';

const { tempPath, finalPath } = workerData;
const dbDir = path.dirname(finalPath);

let tempFd = null;
try {
  tempFd = fs.openSync(tempPath, 'w', 0o600);
  fs.writeFileSync(tempFd, workerData.buffer);
  fs.fsyncSync(tempFd);
  fs.closeSync(tempFd);
  tempFd = null;

  fs.renameSync(tempPath, finalPath);

  try {
    const dirFd = fs.openSync(dbDir, 'r');
    fs.fsyncSync(dirFd);
    fs.closeSync(dirFd);
  } catch {
    // Directory fsync is best-effort on some environments.
  }

  parentPort.postMessage({ ok: true });
} catch (error) {
  if (tempFd !== null) {
    try { fs.closeSync(tempFd); } catch { /* no-op */ }
  }
  if (fs.existsSync(tempPath)) {
    try { fs.unlinkSync(tempPath); } catch { /* no-op */ }
  }
  parentPort.postMessage({ ok: false, error: error.message });
}
