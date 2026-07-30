import type {H3Event} from "h3";
import type {UploadLimits} from "../../server/utils/backend/upload-request";
import {Buffer} from "node:buffer";
import {join} from "node:path";
import {Readable} from "node:stream";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    parseConvertFields,
    parseMultipartUpload,
    parseUploadFields,
    UPLOAD_FIELD_NAMES,
    UPLOAD_RATE_GRACE_MS,
    uploadLimitsFromConfig
} from "../../server/utils/backend/upload-request";
import {makeConfig, makeStorageRoot, registerBackendTestHooks} from "./helpers";

registerBackendTestHooks();

/*
 * A value for every non-file field the client sends, keyed by UPLOAD_FIELD_NAMES. Keying it this
 * way means adding a client field without giving it a value here fails to type-check, forcing this
 * test (and the maxFields budget it guards) to be updated alongside the field list.
 */
const FIELD_VALUES: Record<(typeof UPLOAD_FIELD_NAMES)[number], string> = {
    email: "reader@example.test",
    outputFormat: "mp3",
    splitWithoutChapters: "false"
};

const BOUNDARY = "----chaptifytestboundary";

const buildMultipartBody = (fields: Array<[string, string]>): Buffer => {
    const chunks: Buffer[] = [
        // One file part; formidable's filter requires name="file" with a detectable extension.
        Buffer.from(
            `--${BOUNDARY}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="book.mp3"\r\n` +
                "Content-Type: audio/mpeg\r\n\r\n"
        ),
        Buffer.from("fake-audio-bytes"),
        Buffer.from("\r\n")
    ];

    for (const [name, value] of fields) {
        chunks.push(
            Buffer.from(
                `--${BOUNDARY}\r\n` +
                    `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
                    `${value}\r\n`
            )
        );
    }

    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));

    return Buffer.concat(chunks);
};

const makeEvent = (body: Buffer): H3Event => {
    const request = Readable.from(body) as Readable & Record<string, unknown>;
    request.headers = {
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        "content-length": String(body.length)
    };
    // parseMultipartUpload reads these off the raw Node request.
    request.complete = true;
    request.setTimeout = () => request;
    request.destroy = () => request;

    return {node: {req: request}} as unknown as H3Event;
};

const NO_LIMITS: UploadLimits = {
    maxUploadBytes: 10_485_760,
    idleTimeoutMs: 0,
    maxDurationMs: 0,
    minBytesPerSecond: 0
};

const parse = async (fields: Array<[string, string]>) => {
    const storageRoot = await makeStorageRoot();

    return parseMultipartUpload(
        makeEvent(buildMultipartBody(fields)),
        storageRoot,
        NO_LIMITS,
        () => {}
    );
};

const clientFields = (): Array<[string, string]> =>
    UPLOAD_FIELD_NAMES.map((name) => [name, FIELD_VALUES[name]]);

describe("multipart upload field budget", () => {
    it("accepts a file plus every field the client sends", async () => {
        const parsed = await parse(clientFields());
        const result = parseUploadFields(parsed);

        expect(result.originalFilename).toBe("book.mp3");
        expect(result.email).toBe(FIELD_VALUES.email);
        expect(result.outputFormatValues).toEqual([FIELD_VALUES.outputFormat]);
        expect(result.splitWithoutChapters).toBe(false);
    });

    it("rejects a request carrying more fields than the client is allowed to send", async () => {
        // A field beyond UPLOAD_FIELD_NAMES exceeds the parser's maxFields budget and is refused,
        // guarding against maxFields being set higher than the sanctioned field list.
        await expect(parse([...clientFields(), ["unexpected", "1"]])).rejects.toThrow();
    });
});

describe("multipart convert field parsing", () => {
    it("accepts a file, email, and a target format", async () => {
        const parsed = await parse([
            ["email", "reader@example.test"],
            ["outputFormat", "m4b"]
        ]);
        const result = parseConvertFields(parsed);

        expect(result.originalFilename).toBe("book.mp3");
        expect(result.email).toBe("reader@example.test");
        expect(result.outputFormat).toBe("m4b");
    });

    it("rejects a stray split-only field", async () => {
        const parsed = await parse([
            ["email", "reader@example.test"],
            ["outputFormat", "m4b"],
            ["splitWithoutChapters", "true"]
        ]);

        expect(() => parseConvertFields(parsed)).toThrow();
    });

    it("rejects a missing target format", async () => {
        const parsed = await parse([["email", "reader@example.test"]]);

        expect(() => parseConvertFields(parsed)).toThrow();
    });
});

/*
 * A request whose body is pushed chunk by chunk under fake timers, so a "slow client" can be
 * simulated without the test actually taking that long. `complete` stays false while the body is
 * unfinished, which is what tells parseMultipartUpload an aborted request was cut short.
 */
const makeStreamingEvent = () => {
    const request = new Readable({read() {}}) as Readable & Record<string, unknown>;
    request.headers = {
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        // A plausible large upload: the client claims far more than it ever intends to send.
        "content-length": "1073741824"
    };
    request.complete = false;
    request.setTimeout = () => request;

    return {event: {node: {req: request}} as unknown as H3Event, request};
};

const FILE_PART_HEADER = Buffer.from(
    `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="book.mp3"\r\n` +
        "Content-Type: audio/mpeg\r\n\r\n"
);

/** Pushes `chunk` once per simulated second, `seconds` times. */
const trickle = async (request: Readable, chunk: Buffer, seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
        request.push(chunk);
        await vi.advanceTimersByTimeAsync(1_000);
    }
};

describe("upload request bounds", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("aborts a client that trickles data below the sustained-rate floor", async () => {
        vi.useFakeTimers();
        const storageRoot = await makeStorageRoot();
        const {event, request} = makeStreamingEvent();
        const partialPaths: string[] = [];
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, minBytesPerSecond: 1024},
            (path) => partialPaths.push(path)
        );
        const rejection = expect(parsing).rejects.toThrow(/transfer rate/);

        request.push(FILE_PART_HEADER);
        // One byte per second keeps an idle timer alive forever but is far below 1 KiB/s.
        await trickle(request, Buffer.from("x"), UPLOAD_RATE_GRACE_MS / 1_000 + 5);

        await rejection;
        // The partial file was reported to the caller, whose cleanup deletes it.
        expect(partialPaths).toHaveLength(1);
        expect(partialPaths[0]).toContain(join(storageRoot, "uploads"));
    });

    it("aborts an upload that exceeds the total lifetime even while data keeps arriving", async () => {
        vi.useFakeTimers();
        const storageRoot = await makeStorageRoot();
        const {event, request} = makeStreamingEvent();
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, maxDurationMs: 10_000},
            () => {}
        );
        const rejection = expect(parsing).rejects.toThrow(/total time limit/);

        request.push(FILE_PART_HEADER);
        // Fast enough to satisfy any throughput floor; the hard ceiling still applies.
        await trickle(request, Buffer.alloc(64 * 1024, "x"), 15);

        await rejection;
    });

    it("lets a steady upload finish without tripping either bound", async () => {
        vi.useFakeTimers();
        const storageRoot = await makeStorageRoot();
        const {event, request} = makeStreamingEvent();
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, maxDurationMs: 120_000, minBytesPerSecond: 1024},
            () => {}
        );

        request.push(FILE_PART_HEADER);
        await trickle(request, Buffer.alloc(8 * 1024, "x"), UPLOAD_RATE_GRACE_MS / 1_000 + 5);
        request.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
        request.complete = true;
        request.push(null);

        const parsed = await parsing;

        expect(parseUploadFields.bind(null, parsed)).toThrow(); // no email field was sent
        expect(Object.keys(parsed.files)).toEqual(["file"]);
    });
});

describe("upload limits from config", () => {
    it("converts the configured seconds to milliseconds and passes the byte floor through", async () => {
        const config = makeConfig(await makeStorageRoot());

        expect(uploadLimitsFromConfig(config)).toEqual({
            maxUploadBytes: config.maxUploadBytes,
            idleTimeoutMs: config.uploadIdleTimeoutSeconds * 1000,
            maxDurationMs: config.uploadMaxSeconds * 1000,
            minBytesPerSecond: config.uploadMinBytesPerSecond
        });
    });
});
