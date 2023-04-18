import stream from 'node:stream';
import {Iter, iterSync} from "@j-cake/jcake-utils/iter";

import {Config} from "./index.js";
import Command from "./command/index.js";

export default async function* run(config: Config): AsyncGenerator<{
    stdin: stream.Writable,
    stdout: stream.Readable,
    stderr: stream.Readable
}> {
    for await (const cmd of config.command ? lex([config.command]) : loop())
        yield await Command.from_lexemes(cmd)
            .run();
}

export async function* lex(iter: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string[]> {
    const accumulator: string[] = [];
    const lexemes: string[] = [];

    for await (const chunk of iter)
        for (const {current: char, skip: next} of iterSync.peekable(chunk.split('')))
            if (char == '\\')
                accumulator.push(next());
            // TODO: strings and blocks
            else if (/\s/.test(char))
                if (char == '\n')
                    lexemes.push(accumulator.splice(0, accumulator.length).join(''), '\n');
                else
                    lexemes.push(accumulator.splice(0, accumulator.length).join(''));

            else if (char == ';')
                yield [...lexemes.splice(0, lexemes.length), accumulator.splice(0, accumulator.length).join('')]
                    .filter(i => i.length > 0);

            else
                accumulator.push(char);
}

export async function* loop(): AsyncGenerator<string[]> {
    for await (const cmd of Iter(process.stdin)
        .map(chunk => chunk.toString())
        .pipe(lex))

        yield cmd;
}
