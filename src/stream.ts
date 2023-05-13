import stream from 'node:stream';
import {Iter, iter} from '@j-cake/jcake-utils/iter';

export default interface DoubleEndedStream<T> extends AsyncIterable<T> {
    id: number

    write(data: T),

    read(): Promise<T>,

    close(): void

    concat(other: AsyncIterable<T>, close?: boolean): void,

    collect(): Promise<T[]>,

    split(): DoubleEndedStream<T>
}

export function pipe_from<T>(from: AsyncIterable<T>): DoubleEndedStream<T> {
    const stream = mk_stream<T>();
    Iter(from).map(i => stream.write(i));

    return stream;
}

export function pipe_to<T>(to: stream.Writable): DoubleEndedStream<T> {
    const out = mk_stream<T>();
    stream.Readable.from(out).pipe(to);

    return out;
}

let sid = 0;

const close = Symbol('close');

export function mk_stream<T extends Exclude<any, typeof close>>(): DoubleEndedStream<T> {
    const buffer: (T | typeof close)[] = [];
    const listeners: ((item: T) => void)[] = [];
    let closed = false;

    const splits: DoubleEndedStream<T>[] = [];

    const stream: DoubleEndedStream<T> = {
        id: sid += 1,
        read(): Promise<T> {
            if (buffer[0] === close) {
                closed = true;
                buffer.push(close);
                return Promise.reject('Stream closed');
            }

            if (buffer[0])
                return Promise.resolve(buffer.shift()! as T);

            return new Promise<T>(resolve => listeners.push(resolve));
        },
        write(value: T) {
            if (!closed || value == close) {
                for (const i of splits)
                    i.write(value);

                if (listeners[0])
                    listeners.shift()!(value);
                else
                    buffer.push(value);
            } else
                throw new Error('Stream closed');
        },
        async concat(other: AsyncIterable<T>, close = true) {
            for await (const i of other)
                stream.write(i);

            if (close)
                stream.close();
        },
        split(): DoubleEndedStream<T> {
            const stream = mk_stream<T>();
            splits.push(stream);
            return stream;
        },
        collect(): Promise<T[]> {
            return iter.collect(stream);
        },
        close() {
            stream.write(close as any);
            closed = true;
            for (const split of splits)
                split.close();
        },
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    const next = await stream.read()
                        .catch(e => close);

                    if (next === close)
                        return {value: undefined, done: true};
                    else
                        return {value: next as T, done: false};
                }
            }
        }
    };

    return stream;
}
