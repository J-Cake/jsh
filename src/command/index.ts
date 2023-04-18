import stream from 'node:stream';

export default class Command {
    private constructor(private source: string) {

    }

    public static from_lexemes(words: string[]): Command {

        return new this(words.join(' '));
    }

    public async run(): Promise<{ stdin: stream.Writable, stdout: stream.Readable, stderr: stream.Readable }> {
        return {
            stdin: new stream.Writable(),
            stdout: new stream.Readable(),
            stderr: new stream.Readable()
        };
    }
}
