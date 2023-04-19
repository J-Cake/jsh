import stream from 'node:stream';
import {iterSync} from '@j-cake/jcake-utils/iter';
import log from "./log.js";

export type Pipe = ({
    from_index: string | number,
    from_fd: number,
    corked: false,
    to_index: string | number,
    to_fd: number
} | {
    from_index: string | number,
    from_fd: number,
    corked: true,
})[];
export type LineTree = Array<Pipe | string | LineTree>[];
export const block = Symbol('block');

export default class Command {
    private constructor(private lines: LineTree) {
    }

    public static from_lexemes(words: string[]): Command {
        return new this(this.collapse_blocks(words));
    }

    private static parse_pipe(word: string): Pipe {
        if (!word.startsWith('|') && !word.startsWith('>'))
            throw `Expected pipe operator, got '${word}'`;

        const pipes: Pipe = (word.slice(1) || '>')
            .split(',')
            .map(function (i) {
                // TODO: parse pipe operator
            });

        log.debug('pipe', pipes);

        return pipes;
    }

    private static collapse_blocks(words: string[]): LineTree {
        const lines: LineTree = [[]];

        for (const {current: word, skip: next} of iterSync.peekable(words))
            if (word == '\n' || word.startsWith('|') || word.startsWith('>'))
                if (word == '\n')
                    lines.push([]);
                else
                    lines.push([Command.parse_pipe(word)])
            else if (word == '{') {
                const body: string[] = [];
                let bracket_count = 1;

                for (let i = next(); i != '}' && bracket_count > 0; i = next()) {
                    if (i == '{')
                        bracket_count++;
                    else if (i == '}')
                        bracket_count--;

                    body.push(i);
                }

                lines.at(-1)!.push(Object.defineProperty(this.collapse_blocks(body), block, {value: 'block'}));
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
