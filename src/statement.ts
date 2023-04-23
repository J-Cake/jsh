import * as cp from 'node:child_process';
import stream from 'node:stream';
import {Iter, iter} from '@j-cake/jcake-utils/iter';
import Command, {block, isBlock} from "./command.js";
import log from "./log.js";

export const statement = Symbol('statement');
export const runner = Symbol('runner');

export interface Statement {
    [statement]: true,
    args: string[],
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

export interface DoubleEndedStream<T> extends AsyncIterable<T> {
    write(data: T): Promise<void>,

    read(): Promise<T>,

    join(other: AsyncIterable<T>): void
}

export function pipe_from<T>(from: AsyncIterable<T>): DoubleEndedStream<T> {
    const stream = mk_stream<T>();
    Iter(from).map(i => stream.write(i));

    return stream;
}

export function mk_stream<T>(): DoubleEndedStream<T> {
    const buffer: T[] = [];
    let awaitRead: null | ((item: T) => void) = null;
    const stream: DoubleEndedStream<T> = {
        async write(t) {
            buffer.push(t);
            if (awaitRead)
                awaitRead(buffer.shift()!);
        },
        read() {
            return new Promise(ok => buffer[0] ? ok(buffer.shift()!) : awaitRead = ok);
        },
        async join(other) {
            for await (const i of other)
                await stream.write(i);
        },
        [Symbol.asyncIterator]() {
            return {
                next() {
                    return stream.read().then(i => ({value: i, done: false}));
                }
            }
        }
    };

    return stream;
}

export interface Runner {
    stdin: DoubleEndedStream<Buffer>,
    stdout: DoubleEndedStream<Buffer>,
    stderr: DoubleEndedStream<Buffer>,

    statement: Statement,

    [runner]: true

    start(env: Record<string, string>);
}

export default async function run_statement(statement: Statement): Promise<Runner> {
    const stdio = {
        stdin: mk_stream<Buffer>(),
        stdout: mk_stream<Buffer>(),
        stderr: mk_stream<Buffer>(),
    };
    return {
        ...stdio,
        statement,
        [runner]: true,

        async start(env: Record<string, string>) {
            log.debug(statement);

            const args = await Promise.all(statement.args.map(function (i) {
                if (isBlock(i))
                    return new Command(i)
                        .run(env)
                else return i;
            }));

            for (const [a, subblock] of args.filter(isBlock).entries() as any as [number, Awaited<ReturnType<typeof Command.prototype.run>>][]) {
                subblock.stderr.join(stdio.stderr)
                stdio.stdin.join(subblock.stdin);

                const stdout = Buffer.concat(await iter.collect(subblock.stdout));
                args[a] = stdout.toString();
            }

            const isAllStrings = (args: any[]): args is string[] => args.every(i => typeof i === 'string');
            if (!isAllStrings(args))
                throw new Error('Not all arguments are strings!');

            if (!args[0])
                throw new Error('No command specified!');

            const proc = cp.spawn(args.shift()!, args);

            stream.Readable.from(stdio.stdin).pipe(proc.stdin);
            stdio.stdout.join(proc.stdout);
            stdio.stderr.join(proc.stderr);

            return await new Promise(ok => proc.on('exit', code => ok(code === 0)));
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

    // TODO: Handle terminators

    for (const statement of statements) {
        const runner = await run_statement(statement);
        runner.stdin.join(stdin);
        stdout.join(runner.stdout);
        stderr.join(runner.stderr);

        if (!await runner.start(env))
            break;
    }

    return Object.assign({stdin, stdout, stderr}, {[block]: true});
}
