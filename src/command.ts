import stream from 'node:stream';
import {iterSync} from '@j-cake/jcake-utils/iter';
import log from "./log.js";
import {terminator} from "./run.js";

export type Pipe = (({
    from_index: string | number,
    from_fd: number,
    corked: false,
    to_index: string | number,
    to_fd: number
} | {
    from_index: string | number,
    from_fd: number,
    corked: true,
})[]) & { [pipe]: true };
export type LineTree = Array<Pipe | Array<Pipe | typeof terminator | string | LineTree>>;
export const block = Symbol('block');
export const pipe = Symbol('pipe');

export default class Command {
    private constructor(private lines: LineTree) {
    }

    public static from_lexemes(words: (string|typeof terminator)[]): Command {
        return new this(this.collapse_blocks(words));
    }

    private static parse_pipe(word: string): Pipe {
        if (!word.startsWith('|') && !word.startsWith('>'))
            throw `Expected pipe operator, got '${word}'`;

        const out: Pipe = Object.assign([], { [pipe]: true }) as Pipe;
        for (const pipe of (word.slice(1) || '>').split(',').filter(i => i.length > 0)) {
            const coalesce = <T, R>(i: T | undefined, d: R, cb: (x: T) => R): R => i ? cb(i) : d;

            // TODO: Add |= syntax

            const [from, to] = pipe.match(/^([\w.+-]*)(?:<|>([\w.+-]*))$/)?.slice(1) ?? [];

            const [from_index, from_fd] = from.match(/^([\w+-]*)(?:\.(\d*))?$/)?.slice(1) ?? [];

            if (to === undefined || to === null) {
                out.push({
                    from_index: coalesce(from_index, -1, i => isNaN(Number(i)) ? i : Number(i)),
                    from_fd: coalesce(from_fd, 0, i => Number(i)),
                    corked: true
                });
                continue;
            }

            const [to_index, to_fd] = to.match(/^(?:([\w+-]*)\.)?(\d*)$/)?.slice(1) ?? [];

            const route: Pipe[number] = {
                from_index: coalesce(from_index, -1, i => isNaN(Number(i)) ? i : Number(i)),
                from_fd: coalesce(from_fd, 1, i => Number(i)),
                to_index: coalesce(to_index, +1, i => isNaN(Number(i)) ? i : Number(i)),
                to_fd: coalesce(to_fd, 0, i => Number(i)),
                corked: false
            };

            out.push(route);
        }

        return Object.assign(out, { [pipe]: true });
    }

    private static collapse_blocks(words: (string|typeof terminator)[]): LineTree {
        const lines: LineTree = [[]];

        for (const {current: word, skip: next} of iterSync.peekable(words))
            if (word == terminator)
                lines.push([terminator]);
            else if (word == '\n' || word.startsWith('|') || word.startsWith('>'))
                if (word == '\n')
                    lines.push([]);
                else
                    lines.push(Command.parse_pipe(word))
            else if (word == '{') {
                const body: (string|typeof terminator)[] = [];
                let bracket_count = 1;

                for (let i = next(); i != '}' && bracket_count > 0; i = next()) {
                    if (i == '{')
                        bracket_count++;
                    else if (i == '}')
                        bracket_count--;

                    body.push(i);
                }

                const isPipe = (x: object): x is Pipe => (x as Pipe)[pipe] === true;

                const last = lines.at(-1)!;
                if (isPipe(last))
                    lines.push([Object.assign(this.collapse_blocks(body), {[block]: true})]);
                else
                    last.push(Object.assign(this.collapse_blocks(body), {[block]: true}));

            } else if (word == '}')
                throw `Unexpected '}'`;
            else
                lines.at(-1)!.push(word as any);

        return lines.filter(i => i.length > 0);
    }

    public async run(env: Record<string, string>): Promise<{
        stdin: stream.Writable,
        stdout: stream.Readable,
        stderr: stream.Readable
    }> {
        // get all pipe operators
        log.debug(this.lines);

        throw "Not implemented";
    }
}
