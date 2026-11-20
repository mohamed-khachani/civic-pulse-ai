import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv.includes('--production') ? 'start' : 'dev';
const processes = ['backend', 'front-end'].map((directory) =>
  spawn('npm', ['--prefix', directory, 'run', command], {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  }),
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of processes) {
    if (!child.pid) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
