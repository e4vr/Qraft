import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export function run(command, args, options = {}) {
  let executable = command;
  let executableArgs = args;
  if (process.platform === 'win32' && (command === 'npm.cmd' || command === 'npx.cmd')) {
    const cli = command === 'npm.cmd' ? 'npm-cli.js' : 'npx-cli.js';
    executable = process.execPath;
    executableArgs = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', cli), ...args];
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
    input: options.input,
    stdio: options.capture || options.input ? ['pipe', options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '');
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

export const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
