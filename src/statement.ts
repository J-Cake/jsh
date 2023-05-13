import * as cp from 'node:child_process';
import stream from 'node:stream';

import Command, {block, isBlock, LineTree} from "./command.js";
import log from "./log.js";
import {terminator} from "./run.js";
import DoubleEndedStream, {mk_stream, pipe_from, pipe_to} from "./stream.js";
import split_view from "./split_view.js";
import lang_struct from "./lang_struct.js";
import library_fn from "./library_fn.js";
import executable from "./executable.js";

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
        corked: true,
        to: null,
        stmt: null
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

export interface Running {
    stdin: DoubleEndedStream<Buffer>,
    stdout: DoubleEndedStream<Buffer>,
    stderr: DoubleEndedStream<Buffer>,
    exit(): Promise<boolean>
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

            const source = await lang_struct(statement.args as any)
                .catch(() => library_fn(statement.args as any))
                .catch(() => executable(statement.args as any, env));

            const dest = await Promise.all(statement.dest.map(i => lang_struct(i.stmt!.args as any)
                .catch(() => library_fn(i.stmt!.args as any))
                .catch(() => executable(i.stmt!.args as any, env))));

            //     const runners = [
            //         await lang_struct(statement.args as any)
            //             .catch(() => library_fn(statement.args as any))
            //             .catch(() => executable(statement.args as any, env)),
            //
            //         ...await Promise.all(statement.dest.map(i => lang_struct(i.stmt!.args as any)
            //             .catch(() => library_fn(i.stmt!.args as any))
            //             .catch(() => executable(i.stmt!.args as any, env))))
            //     ];
            //
            //     for (const [a, i] of statement.dest.entries())
            //         if (i.stmt)
            //             [
            //                 runners[a + 1].stdin,
            //                 runners[a + 1].stdout,
            //                 runners[a + 1].stderr,
            //             ][i.to].concat([
            //                 runners[0].stdin.split(),
            //                 runners[0].stdout.split(),
            //                 runners[0].stderr.split(),
            //             ][i.from]);
            //
            //     runners[0].stdin.concat(stdio.stdin);
            //     stdio.stdout.concat(runners.at(-1)!.stdout);
            //     stdio.stderr.concat(runners.at(-1)!.stderr);
            //
            //     return await Promise.all(runners.map(i => i.exit()))
            //         .then(res => res.every(i => i));
            // }
            return false;
        }
    };

}

export async function run_block(statements: Statement[], env: Record<string, string>): Promise<Running> {
    const stdin = mk_stream<Buffer>();
    const stdout = mk_stream<Buffer>();
    const stderr = mk_stream<Buffer>();

    const awaited: Promise<boolean>[] = [];
    for (const i of statements)
        if (i.args !== terminator) {
            const runner = run_statement(i);
            runner.stdin.concat(stdin);
            stdout.concat(runner.stdout);
            stderr.concat(runner.stderr);

            awaited.push(runner.start(env));
        } else if (!await awaited.pop())
            break;

    if (awaited.length > 0)
        log.verbose(`There are still statements waiting for termination! (${awaited.length})`);

    return Object.assign({
        stdin,
        stdout,
        stderr,
        exit: () => Promise.all(awaited).then(res => res.every(i => i))
    }, {[block]: true});
}
