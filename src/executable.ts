import fs from 'node:fs/promises';
import stream from 'node:stream';
import cp from 'node:child_process';

import {runner, Runner, Running} from "./statement.js";
import log from "./log.js";
import Command, {isBlock, LineTree} from "./command.js";
import {mk_stream} from "./stream.js";
import {config} from "./index.js";

export async function locate_executable(hint: string): Promise<string> {
    if (await fs.stat(hint)
        .then(i => i.isFile())
        .catch(() => false))
        return hint;

    for (const i of config.get().find_executables)
        if (await fs.stat(`${i}/${hint}`)
            .then(i => i.isFile())
            .catch(() => false))
            return `${i}/${hint}`;

    throw new Error(`Could not find executable ${hint}`);
}

export const isRunner = (x: any): x is Runner => typeof x == 'object' && runner in x || isBlock(x);

export default async function executable(cmd: LineTree, env: Record<string, string>): Promise<Running> {
    const _args = await Promise.all(cmd.map(i => isBlock(i) ? new Command(i)
        .run(env) : i));
    const args = await Promise.all(_args.map(i => isRunner(i) ? i.stdout.collect()
        .then(buf => Buffer.concat(buf).toString('utf8')) :
        i as any as string)); // can safely cast to string, as we've established before that all other objects which it could be are considered

    const stdin = mk_stream<Buffer>();
    const stdout = mk_stream<Buffer>();
    const stderr = mk_stream<Buffer>();

    const exe = await locate_executable(args[0]);

    const proc: cp.ChildProcessWithoutNullStreams = cp.spawn(exe, args.slice(1), {
        env,
        cwd: env.PWD ?? process.cwd(),
        stdio: []
    });

    proc.once('exit', function(code) {
        log.debug(`Process ${args[0]} exited with code`, code ?? 'null');
        stdin.close();
        stdout.close();
        stderr.close();
    });

    stream.Readable.from(stdin).pipe(proc.stdin);
    stdout.concat(proc.stdout);
    stderr.concat(proc.stderr);

    return {
        stdin,
        stdout,
        stderr,
        exit: () => new Promise<boolean>(ok => proc.once('exit', code => ok(code == 0)))
    };
}
