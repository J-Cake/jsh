import stream from 'node:stream';
import {iterSync} from '@j-cake/jcake-utils/iter';
import log from "../log.js";

export type LineTree = Array<string[] | LineTree>;
export const block = Symbol('block');

export default class Command {
    public static from_lexemes(words: string[]): Command {
        const lines = this.collapse_blocks(words);
        log.debug("lines:", lines);
        return new this();
    }

    private static collapse_blocks(words: string[]): LineTree {
        const lines: LineTree = [[]];

        for (const {current: word, skip: next} of iterSync.peekable(words))
            if (word == '\n')
                lines.push([]);
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

                lines.push(Object.defineProperty(this.collapse_blocks(body), block, {value: 'block'}), []);
            } else if (word == '}')
                throw `Unexpected '}'`;
            else
                (lines[lines.length - 1] as string[]).push(word);

        return lines.filter(i => i.length > 0);
    }

    public async run(): Promise<{ stdin: stream.Writable, stdout: stream.Readable, stderr: stream.Readable }> {
        throw `Not implemented`;
    }
}
