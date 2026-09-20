import childProcess from 'child_process';

import { createDebug } from 'obug';

const CMD_DEBUG = createDebug('CMD');

export function exec(
  cmd: string,
  { log, maxBuffer }: { log: boolean | string; maxBuffer?: number } = {
    log: true,
  }
) {
  if (typeof log === 'string') {
    CMD_DEBUG(`$ ${log}`);
  } else if (log === true) {
    CMD_DEBUG(`$ ${cmd}`);
  }

  if (process.platform !== 'linux') {
    return Promise.resolve('');
  }

  return new Promise<string>((resolve, reject) => {
    childProcess.exec(
      cmd,
      {
        shell: 'bash',
        maxBuffer,
      },
      (err, stdout) => {
        if (err) return reject(err);
        return resolve(String(stdout).trim());
      }
    );
  });
}
