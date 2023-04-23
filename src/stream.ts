import stream from 'node:stream';
import {Iter, iter} from '@j-cake/jcake-utils/iter';
import log from "./log.js";

export default interface DoubleEndedStream<T> extends AsyncIterable<T> {
    id: number

    write(data: T),

    read(): Promise<T>,

    close(): void

    join(other: AsyncIterable<T>, close?: boolean): void,

    collect(): Promise<T[]>,
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

// export function mk_stream<T>(): DoubleEndedStream<T> {
//     const buffer: IteratorResult<T>[] = [];
//     let awaitRead: ((item: T) => void)[] = [];
//     let closed = false;
//
//     const id = sid += 1;
//     log.debug('new stream', id);
//
//     const stream: DoubleEndedStream<T> = {
//         id,
//         async write(t) {
//             if (closed)
//                 return Promise.reject('Stream closed');
//
//             buffer.push(t);
//             awaitRead.shift()?.(buffer.shift()!);
//         },
//         read() {
//             if (closed)
//                 log.debug('draining', stream.id, 'with', buffer.length, 'items');
//
//             if (closed && buffer.length == 0 && awaitRead.length == 0) {
//                 log.debug('Stream closed', stream.id);
//                 return Promise.reject('Stream closed');
//             }
//
//             if (buffer[0])
//                 return Promise.resolve(buffer.shift()!);
//
//             return new Promise<T>(resolve => awaitRead.push(resolve));
//         },
//         async join(other, close = true) {
//             log.debug('joining streams', stream.id, 'and', other['id'] ??= sid += 1);
//
//             for await (const i of other) {
//                 log.debug('Forwarding', i, 'from', other['id'], 'to', stream.id);
//                 await stream.write(i);
//             }
//
//             if (close)
//                 stream.close();
//         },
//         close() {
//             log.debug('closing stream', stream.id);
//             closed = true;
//         },
//         async collect() {
//             const buf: T[] = [];
//
//             for await (const i of stream)
//                 buf.push(i);
//
//             log.debug('look at my collection!', buf);
//
//             return buf;
//         },
//         [Symbol.asyncIterator]() {
//             return {
//                 async next() {
//                     const next = await stream.read()
//                         .catch(err => err);
//
//                     log.debug('next', next, stream.id);
//
//                     if (next)
//                         return {value: next, done: false};
//
//                     return {value: undefined, done: true};
//                     // return stream.read()
//                     //     .then(i => ({value: i, done: false}))
//                     //     .catch(() => ({value: undefined, done: true}));
//                 }
//             }
//         }
//     };
//
//     return stream;
// }

const close = Symbol('close');

export function mk_stream<T extends Exclude<any, typeof close>>(): DoubleEndedStream<T> {
    const buffer: (T | typeof close)[] = [];
    const listeners: ((item: T) => void)[] = [];
    let closed = false;

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
            if (!closed)
                if (listeners[0])
                    listeners.shift()!(value);
                else
                    buffer.push(value);
            else
                throw new Error('Stream closed');
        },
        async join(other: AsyncIterable<T>, close = true) {
            for await (const i of other)
                stream.write(i);

            if (close)
                stream.close();
        },
        collect(): Promise<T[]> {
            return iter.collect(stream);
        },
        close() {
            stream.write(close as any);
            closed = true;
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
