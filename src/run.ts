import stream from 'node:stream';
import {Iter, iterSync} from "@j-cake/jcake-utils/iter";

import {Config} from "./index.js";
import Command from "./command/index.js";
import log from "./log.js";

export default async function* run(config: Config): AsyncGenerator<{
    stdin: stream.Writable,
    stdout: stream.Readable,
    stderr: stream.Readable
}> {
    for await (const cmd of config.command ? lex([config.command]) : loop())
        yield await Command.from_lexemes(cmd)
            .run();
}

export async function* chars(iter: AsyncIterable<Buffer> | Iterable<Buffer>): AsyncGenerator<string> {
    let prev_was_cr = false;
    for await (const chunk of iter)
        for (const char of chunk.toString())
            if (char == '\r')
                prev_was_cr = true;
            else if (prev_was_cr) {
                if (char != '\n') yield '\r';
                yield char;

                prev_was_cr = false;
            } else
                yield char;
}

export async function* lex(iter: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string[]> {
    const accumulator: string[] = [];
    const lexemes: string[] = [];
    let brace_count = 0;
    let string_started = false;

    for await (const chunk of iter)
        for (const {current: char, skip: next} of iterSync.peekable(chunk.split('')))
            if (char == '\\')
                accumulator.push(next());
            else if (char == '"')
                if (string_started) {
                    lexemes.push(accumulator.splice(0, accumulator.length).join(''));
                    string_started = false;
                } else
                    string_started = true;
            else if (string_started)
                accumulator.push(char);
            else if (char == '{') {
                brace_count++;
                lexemes.push(accumulator.splice(0, accumulator.length).join(''), '{');
            } else if (char == '}') {
                brace_count--;

                lexemes.push(accumulator.splice(0, accumulator.length).join(''), '}');

                if (brace_count < 0)
                    throw `Unexpected '}'`;
            } else if (char == ';' && brace_count == 0)
                yield [...lexemes.splice(0, lexemes.length), accumulator.splice(0, accumulator.length).join('')]
                    .filter(i => i.length > 0);

            else if (/[\s;]/.test(char))
                if (char == '\n')
                    lexemes.push(accumulator.splice(0, accumulator.length).join(''), '\n');
                else
                    lexemes.push(accumulator.splice(0, accumulator.length).join(''));

            else
                accumulator.push(char);
}

export async function* loop(): AsyncGenerator<string[]> {
    for await (const cmd of Iter(process.stdin)
        .pipe(chars)
        .pipe(lex)) {
        log.debug("cmd:", cmd);
        yield cmd;
    }
}
