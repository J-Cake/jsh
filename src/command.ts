import {iterSync} from '@j-cake/jcake-utils/iter';
import {terminator} from "./run.js";
import {run_block, Running, Statement, statement} from "./statement.js";

export type Pipe = {
    [pipe]: true,
    routes: ({
        from_index: string | number,
        from_fd: number,
        corked: false,
        to_index: string | number,
        to_fd: number
    } | {
        from_index: string | number,
        from_fd: number,
        corked: true,
    })[]
};
export const isPipe = (x: any): x is Pipe => x[pipe] === true;
export const isBlock = (x: any): x is LineTree => x[block] === true;

export type LineTree = Array<Pipe | typeof terminator | Array<Pipe | typeof terminator | string | LineTree>>;
export const block = Symbol('block');
export const pipe = Symbol('pipe');

export default class Command {
    constructor(private lines: LineTree) {
    }

    public static from_lexemes(words: (string | typeof terminator)[]): Command {
        return new this(this.collapse_blocks(words));
    }

    public static separate(lines: LineTree): Statement[] {
        const statements: Statement[] = [];
        const pipes: Pipe = {
            [pipe]: true,
            routes: []
        };

        for (const line of lines) {
            if (!isPipe(line))
                statements.push({
                    [statement]: true,
                    args: line as any,
                    dest: [],
                    is_root: true
                });
            else
                pipes.routes.push(...line.routes.map(i => ({
                    from_fd: i.from_fd,
                    from_index: typeof i.from_index == 'string' ? i.from_index : statements.length + i.from_index,
                    ...(i.corked ? {
                        corked: true as true
                    } : {
                        corked: false as false,
                        to_fd: i.to_fd,
                        to_index: typeof i.to_index == 'string' ? i.to_index : statements.length + i.to_index - 1
                    })
                })));
        }

        for (const i of pipes.routes) {
            const stmt = typeof i.from_index == 'string' ? statements.find(j => j.label == i.from_index) : statements[i.from_index];

            if (!stmt)
                throw `Pipe from '${i.from_index}' not found`;

            if (i.corked)
                stmt.dest.push({
                    corked: true,
                    from: i.from_fd,
                    to: null,
                    stmt: null
                });

            else {
                const dest = typeof i.to_index == 'string' ? statements.find(j => j.label == i.to_index) : statements[i.to_index];
                if (!dest)
                    throw `Pipe to '${i.to_index}' not found`;

                dest.is_root = false;

                stmt.dest.push({
                    corked: false,
                    from: i.from_fd,
                    to: i.to_fd,
                    stmt: dest
                });
            }
        }

        return Object.assign(statements.filter(i => i.is_root), {[block]: true});
    }

    private static parse_pipe(word: string): Pipe {
        if (!word.startsWith('|') && !word.startsWith('>'))
            throw `Expected pipe operator, got '${word}'`;

        const out: Pipe['routes'] = [];
        for (const pipe of (word.slice(1) || '>').split(',').filter(i => i.length > 0)) {
            const coalesce = <T, R>(i: T | undefined, d: R, cb: (x: T) => R): R => i ? cb(i) : d;

            // TODO: Add |= syntax

            const [from, to] = pipe.match(/^([\w.+-]*)(?:<|>([\w.+-]*))$/)?.slice(1) ?? [];

            const [from_index, from_fd] = from.match(/^([\w+-]*)(?:\.(\w*))?$/)?.slice(1) ?? [];

            if (to === undefined || to === null) {
                out.push({
                    from_index: coalesce(from_index, -1, i => isNaN(Number(i)) ? i : Number(i)),
                    from_fd: coalesce(from_fd, 0, i => Number(i)),
                    corked: true
                });
                continue;
            }

            const [to_index, to_fd] = to.match(/^(?:([\w+-]*)\.)?(\w*)$/)?.slice(1) ?? [];

            const route: Pipe['routes'][number] = {
                from_index: coalesce(from_index, -1, i => isNaN(Number(i)) ? i : Number(i)), // TODO: Check for FD aliases i/o/e
                from_fd: coalesce(from_fd, 1, i => Number(i)),
                to_index: coalesce(to_index, +1, i => isNaN(Number(i)) ? i : Number(i)), // TODO: Check for FD aliases i/o/e
                to_fd: coalesce(to_fd, 0, i => Number(i)),
                corked: false
            };

            out.push(route);
        }

        return {
            [pipe]: true,
            routes: out
        };
    }

    static collapse_blocks(words: (string | typeof terminator)[]): LineTree {
        const lines: LineTree = [[]];

        for (const {current: word, skip: next} of iterSync.peekable(words))
            if (word == terminator)
                lines.push(terminator, []);
            else if (word == '\n' || word.startsWith('|') || word.startsWith('>'))
                if (word == '\n')
                    lines.push([]);
                else
                    lines.push(Command.parse_pipe(word))
            else if (word == '{') {
                const body: (string | typeof terminator)[] = [];
                let bracket_count = 1;

                for (let i = next(); i != '}' && bracket_count > 0; i = next()) {
                    if (i == '{')
                        bracket_count++;
                    else if (i == '}')
                        bracket_count--;

                    body.push(i);
                }

                const last = lines.at(-1)!;
                if (isPipe(last) || typeof last == 'symbol')
                    lines.push([Object.assign(this.collapse_blocks(body), {[block]: true})]);
                else
                    last.push(Object.assign(this.collapse_blocks(body), {[block]: true}));

            } else if (word == '}')
                throw `Unexpected '}'`;
            else {
                const last = lines.at(-1)!;
                if (!isPipe(last) && typeof last != 'symbol')
                    last.push(word as any);
                else
                    lines.push([word as any]);
            }

        return lines.filter(i => isPipe(i) || typeof i == 'symbol' || i.length > 0);
    }

    public async run(env: Record<string, string>): Promise<Running> {
        const loose_parts = Command.separate(this.lines);

        return await run_block(loose_parts, env);
    }
}
