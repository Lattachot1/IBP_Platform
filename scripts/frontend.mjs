import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['setup', 'dev', 'build', 'check'].includes(mode)) {
  throw new Error('Use npm run setup, dev, build or check from the repository root.');
}
const cwd = fileURLToPath(new URL('../Frontend/', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  throw new Error('Start this command through npm, for example: npm run dev.');
}

const env = { ...process.env, INIT_CWD: cwd };
// Nested npm must resolve the frontend, not inherit the root lifecycle package.
for (const key of ['npm_config_local_prefix', 'npm_package_json', 'npm_lifecycle_event', 'npm_lifecycle_script']) {
  delete env[key];
}
function npm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[frontend] ${mode === 'setup' ? 'Clean installation from lockfile' : 'Checking and installing dependencies'}...`);
npm([mode === 'setup' ? 'ci' : 'install', '--include=dev']);
const require = createRequire(new URL('../Frontend/package.json', import.meta.url));
for (const name of ['three', 'three/addons/controls/OrbitControls.js', '@types/three/package.json']) {
  require.resolve(name);
}
console.log('[frontend] three, OrbitControls and TypeScript definitions are installed.');
if (mode !== 'setup') npm(['run', mode, '--', ...process.argv.slice(3)]);
