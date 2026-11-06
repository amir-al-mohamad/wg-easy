import childProcess from 'child_process';

import { createDebug } from 'obug';

const CMD_DEBUG = createDebug('CMD');

type ExecOptions = {
  log: boolean | string;
  maxBuffer?: number;
  /** Written to the command's stdin, for batch input such as `iptables-restore`. */
  input?: string;
};

export function exec(
  cmd: string,
  { log, maxBuffer, input }: ExecOptions = { log: true }
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
    const child = childProcess.exec(
      cmd,
      {
        shell: 'bash',
        maxBuffer,
      },
      (err, stdout) => {
        if (err) {
          return reject(err);
        }
        return resolve(String(stdout).trim());
      }
    );
    child.stdin?.end(input);
  });
}
