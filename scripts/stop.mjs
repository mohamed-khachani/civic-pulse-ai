import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const listeners = spawnSync('lsof', ['-t', '-iTCP:3000', '-iTCP:8000', '-sTCP:LISTEN'], { encoding: 'utf8' });
for (const pid of new Set((listeners.stdout || '').trim().split(/\s+/).filter(Boolean))) {
  const cwd = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout || '';
  const directory = cwd.split('\n').find((line) => line.startsWith('n'))?.slice(1);
  if (!directory || (directory !== root && !directory.startsWith(root + path.sep))) {
    console.log(`Se conserva el proceso ${pid}: no pertenece a este repositorio.`);
    continue;
  }
  try { process.kill(Number(pid), 'SIGTERM'); console.log(`Servicio detenido: ${pid}`); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const result = spawnSync('docker', ['compose', '-f', path.join(root, 'db/docker-compose.yml'), 'stop'], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
