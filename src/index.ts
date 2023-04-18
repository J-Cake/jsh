import stream from 'node:stream';
import State from '@j-cake/jcake-utils/state';
import {iterSync} from '@j-cake/jcake-utils/iter';
import * as Format from '@j-cake/jcake-utils/args';

import log from './log.js';
import run from "./run.js";

type LogLevel = keyof typeof log;

export interface Config {
    logLevel: LogLevel;
    command?: string;
    prompt: ((line: number) => Promise<string>);
    cwd: string
}

export const config: State<Config> = new State({
    logLevel: 'info' as LogLevel,
    prompt: async line => `${config.get().cwd}: `,
    cwd: process.cwd()
});

export const cb = <T extends any[]>(cb: (ok: (...T) => void) => void) => new Promise(ok => cb((v: T) => ok(v)));

export default async function main(argv: string[]): Promise<boolean> {
    const logLevel = Format.oneOf(Object.keys(log) as LogLevel[], false);

    for (const {current: i, skip: next} of iterSync.peekable(argv))
        if (i == '--log-level')
            config.setState({logLevel: logLevel(next())});

        else if (i == '--command' || i == '-c')
            config.setState({command: next()});

    for await (const {stdin, stdout, stderr} of run(config.get())) {
        process.stdin.pipe(stdin, {end: false});
        stdout.pipe(process.stdout, {end: false});
        stderr.pipe(process.stderr, {end: false});
    }

    return true;
}
