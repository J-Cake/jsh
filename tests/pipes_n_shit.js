import cp from 'node:child_process';

const proc = cp.spawn('node', ['-p', 'Boolean(process.stdin.isTTY)'], { stdio: 'inherit' });

// process.stdin.pipe(proc.stdin);
// proc.stdout.pipe(process.stdout);
// proc.stderr.pipe(process.stderr);

await new Promise((ok, err) => proc.once('exit', code => code == 0 ? ok() : err()));
