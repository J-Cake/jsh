import * as cp from 'node:child_process';
import stream from 'node:stream';

import Command, {block, isBlock} from "./command.js";
import log from "./log.js";
import {terminator} from "./run.js";
import DoubleEndedStream, {mk_stream, pipe_from, pipe_to} from "./stream.js";

export const statement = Symbol('statement');
export const runner = Symbol('runner');

export interface Statement {
    [statement]: true,
    args: string[] | typeof terminator,
    label?: string,

    is_root: boolean,

    dest: ({
        from: number,
    } & ({
        to: number,
        stmt: Statement,
        corked: false
    } | {
        corked: true
    }))[],
}

export interface Runner {
    stdin: DoubleEndedStream<Buffer>,
    stdout: DoubleEndedStream<Buffer>,
    stderr: DoubleEndedStream<Buffer>,

    statement: Statement,

    [runner]: true

    start(env: Record<string, string>): Promise<boolean>;
}

export default function run_statement(statement: Statement): Runner {
    const stdio = {
        stdin: mk_stream<Buffer>(),
        stdout: mk_stream<Buffer>(),
        stderr: mk_stream<Buffer>(),
    };
    return {
        ...stdio,
        statement,
        [runner]: true,

        async start(env: Record<string, string>): Promise<boolean> {
            if (statement.args === terminator)
                return true;

            const args = await Promise.all(statement.args.map(i => {
                if (isBlock(i))
                    return new Command(i).run(env);
                else return i;
            }));

            for (const [a, subblock] of args.entries() as any as [number, Awaited<ReturnType<typeof Command.prototype.run>>][]) {
                if (!isBlock(subblock))
                    continue;

                subblock.stderr.join(stdio.stderr);
                stdio.stdin.join(subblock.stdin);

                const stdout = Buffer.concat(await subblock.stdout.collect());

                args[a] = stdout.toString();
            }

            const isAllStrings = (args: any[]): args is string[] => args.every(i => typeof i === 'string');
            if (!isAllStrings(args))
                throw new Error('Not all arguments are strings!');

            if (!args[0])
                throw new Error('No command specified!');

            const proc = cp.spawn(args.shift()!, args, {
                env,
                cwd: env.PWD ?? process.cwd()
            });

            stream.Readable.from(stdio.stdin).pipe(proc.stdin);

            // TODO: Obey pipes

            const substatements: Statement[] = statement.dest
                .map(i => i['stmt'])
                .filter(i => !!i);
            const runners = substatements.map(run_statement);

            for (const [i, {from, corked, to}] of statement.dest.entries() as Iterable<[number, {
                from: number,
                corked: boolean,
                to?: number
            }]>) {
                if (corked || typeof to != 'number')
                    continue;

                const prev: Runner | cp.ChildProcessWithoutNullStreams = runners[i - 1] ?? proc;
                const stmt = runners[i];

                const _from = [
                    runner in prev ? prev.stdin : pipe_to<Buffer>((prev as cp.ChildProcessWithoutNullStreams).stdin),
                    pipe_from(prev.stdout),
                    pipe_from(prev.stderr),
                ];
                const _to = [
                    stmt.stdin,
                    stmt.stdout,
                    stmt.stderr
                ];

                log.debug('Piping', _from[from], 'to', _to[to]);

                _to[to].join(_from[from]);
            }

            log.debug('Plumbing connected, lesgoo');
            const running = runners.map(i => i.start(env));

            const last = runners.at(-1);
            if (!last) {
                log.debug(`There's nowhere to pipe to, piping to block`);
                stdio.stdout.join(proc.stdout);
                stdio.stderr.join(proc.stderr);

                return new Promise<boolean>(ok => proc.on('exit', code => ok(code === 0)));
            }

            stdio.stdout.join(last.stdout);
            stdio.stderr.join(last.stderr);

            return Promise.all([new Promise<boolean>(ok => proc.on('exit', code => ok(code === 0))), ...running])
                .then(proc => proc.every(i => i));
        }
    };

}

export async function run_block(statements: Statement[], env: Record<string, string>): Promise<{
    stdin: DoubleEndedStream<Buffer>,
    stdout: DoubleEndedStream<Buffer>,
    stderr: DoubleEndedStream<Buffer>,
}> {
    const stdin = mk_stream<Buffer>();
    const stdout = mk_stream<Buffer>();
    const stderr = mk_stream<Buffer>();

    const awaited: Promise<boolean>[] = [];
    for (const i of statements)
        if (i.args !== terminator) {
            const runner = run_statement(i);
            runner.stdin.join(stdin);
            stdout.join(runner.stdout);
            stderr.join(runner.stderr);

            awaited.push(runner.start(env));
        } else if (!await awaited.pop())
            break;

    if (awaited.length > 0)
        log.verbose(`There are still statements waiting for termination! (${awaited.length})`);

    return Object.assign({
        stdin,
        stdout,
        stderr
    }, {[block]: true});
}
