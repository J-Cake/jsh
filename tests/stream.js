import cp from 'node:child_process';
import * as stream from '../build/ts/stream.js';

const pipe1 = stream.mk_stream();
const pipe2 = stream.mk_stream();

const proc = cp.spawn('cat', ['package.json']);

console.log(pipe1, pipe2);

pipe1.join(proc.stdout);
pipe2.join(pipe1);

// for await (const i of pipe2)
//     console.log("packet", i);

for (let iter = pipe2[Symbol.asyncIterator](), i = await iter.next(); !i.done; i = await iter.next())
    console.log('packet', i);

console.log('closing');
