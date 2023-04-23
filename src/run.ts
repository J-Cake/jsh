import _ from 'lodash';
import {Iter} from "@j-cake/jcake-utils/iter";

import {Config} from "./index.js";
import Command from "./command.js";
import {DoubleEndedStream} from "./statement.js";

export default async function* run(config: Config): AsyncGenerator<{
    stdin: DoubleEndedStream<Buffer>
    stdout: DoubleEndedStream<Buffer>
    stderr: DoubleEndedStream<Buffer>
}> {
    for await (const cmd of config.command ? lex([config.command]) : loop())
        yield await Command.from_lexemes(cmd)
            .run(_.filter(process.env, (i, a) => i && a as any) as any);
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

export async function* peekable<T>(iterator: AsyncIterable<T> | Iterable<T>): AsyncGenerator<{
    current: T,
    skip: () => Promise<T>
}> {
    const iter = iterator[Symbol.asyncIterator]?.() ?? iterator[Symbol.iterator]?.();

    for (let i = await iter.next(); !i.done; i = await iter.next())
        yield {current: i.value, skip: async () => (i = await iter.next()).value};
}

export const terminator = Symbol(';');

export async function* lex(iter: AsyncIterable<string> | Iterable<string>): AsyncGenerator<(string|typeof terminator)[]> {
    const accumulator: string[] = [];
    const lexemes: (string|typeof terminator)[] = [];
    let brace_count = 0;
    let string_started = false;

    for await (const {current: char, skip: next} of Iter(iter)
        .pipe(peekable))

        if (char == '\\')
            accumulator.push(await next());
        else if (char == '#')
            for (let i = await next(); i != '\n'; i = await next());
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
                .filter(i => typeof i == 'string' ? i.length > 0 : true);

        else if (/[\s;]/.test(char))
            if (char == '\n')
                lexemes.push(accumulator.splice(0, accumulator.length).join(''), '\n');
            else if (char == ';')
                lexemes.push(accumulator.splice(0, accumulator.length).join(''), terminator);
            else
                lexemes.push(accumulator.splice(0, accumulator.length).join(''));

        else
            accumulator.push(char);
}

export async function* loop(): AsyncGenerator<(string|typeof terminator)[]> {
    for await (const cmd of Iter(process.stdin)
        .pipe(chars)
        .pipe(lex))

        yield cmd;
}
