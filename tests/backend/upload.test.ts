import type {H3Event} from "h3";
import type {UploadLimits} from "../../server/utils/backend/upload-request";
import {Buffer} from "node:buffer";
import {join} from "node:path";
import {Readable} from "node:stream";
import {errors as formidableErrors} from "formidable";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    classifyUploadRequestError,
    parseConvertFields,
    parseMultipartUpload,
    parseUploadFields,
    UPLOAD_FIELD_NAMES,
    UPLOAD_RATE_GRACE_MS,
    UploadAbortedError,
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

/*
 * A readiness barrier for the fake-timer tests below, and the reason they are not flaky.
 *
 * `parseMultipartUpload` awaits `mkdir` before it enters its promise executor, and the executor is
 * where `startedAtMs` is captured and the watchdog `setInterval` is created. `advanceTimersByTimeAsync`
 * flushes microtasks but does not wait for filesystem I/O, so a test that advances fake time straight
 * after calling it can run its whole trickle loop while that `mkdir` is still pending. The watchdog
 * then installs after the last advancement, reads an already-advanced fake clock as its start time,
 * and never fires — because nothing moves time again. The upload rejection stays pending and the test
 * times out. This was an intermittent CI failure, not a hypothetical.
 *
 * Raising the Vitest timeout does not help: the interval needs fake time to be *advanced*, not more
 * real time to be waited. The fix has to be ordering.
 *
 * `fileBegin` is the earliest event that proves the watchdog is live: formidable can only report it
 * from inside `form.parse`, which the executor calls after creating the interval. So awaiting it means
 * `mkdir` has resolved, `startedAtMs` is pinned to fake-time zero, and the interval is running.
 */
const fileBeginBarrier = () => {
    let began: (path: string) => void = () => {};
    const begun = new Promise<string>((resolve) => {
        began = resolve;
    });

    return {begun, onFileBegin: (path: string) => began(path)};
};

/*
 * Starts the file part and waits for formidable to open it. One body byte is pushed as well as the
 * headers, because formidable reports `fileBegin` when it starts writing the file, not when it has
 * merely seen the part header. Returns the partial file's path.
 */
const startFileAndAwaitWatchdog = async (request: Readable, begun: Promise<string>) => {
    request.push(FILE_PART_HEADER);
    request.push(Buffer.from("x"));

    return await begun;
};

/*
 * Drains everything already pushed into the request and confirms formidable has taken it, before the
 * caller lets fake time run on.
 *
 * Two things make this necessary. The watchdog compares a byte counter fed by formidable's `progress`
 * event against the fake clock, and advancing fake time does not wait for the work that feeds that
 * counter — so on a loaded machine the clock can cross the rate-floor grace period while only the part
 * header has been counted, and a healthy upload is aborted for a throughput problem the test never
 * simulated. But the stream also cannot drain without the clock moving at all: Node pumps reads through
 * `setImmediate`, which the fake timers replace, so time has to advance *a little* for any byte to move.
 *
 * Hence small steps that stay inside the grace window — the floor is only evaluated once elapsed
 * reaches UPLOAD_RATE_GRACE_MS, so pumping below that cannot trip it.
 *
 * `readableLength` is the observable, not the file on disk: formidable reports the file's intended path
 * at `fileBegin` but creates it lazily, so its size is not a reliable proxy. Bytes leaving the request's
 * buffer means formidable has received them, and it counts them as it receives them.
 */
const PUMP_STEP_MS = 100;

const pumpUntilConsumed = async (request: Readable) => {
    const maxSteps = Math.floor(UPLOAD_RATE_GRACE_MS / PUMP_STEP_MS) - 10;

    for (let step = 0; step < maxSteps; step += 1) {
        if (request.readableLength === 0) {
            return;
        }

        await vi.advanceTimersByTimeAsync(PUMP_STEP_MS);
    }

    throw new Error(
        `request still held ${request.readableLength} unconsumed bytes inside the grace window`
    );
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
        const {begun, onFileBegin} = fileBeginBarrier();
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, minBytesPerSecond: 1024},
            (path) => {
                partialPaths.push(path);
                onFileBegin(path);
            }
        );
        const rejection = expect(parsing).rejects.toThrow(/transfer rate/);

        await startFileAndAwaitWatchdog(request, begun);
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
        const {begun, onFileBegin} = fileBeginBarrier();
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, maxDurationMs: 10_000},
            onFileBegin
        );
        const rejection = expect(parsing).rejects.toThrow(/total time limit/);

        await startFileAndAwaitWatchdog(request, begun);
        // Fast enough to satisfy any throughput floor; the hard ceiling still applies.
        await trickle(request, Buffer.alloc(64 * 1024, "x"), 15);

        await rejection;
    });

    it("lets a steady upload finish without tripping either bound", async () => {
        vi.useFakeTimers();
        const storageRoot = await makeStorageRoot();
        const {event, request} = makeStreamingEvent();
        const {begun, onFileBegin} = fileBeginBarrier();
        const parsing = parseMultipartUpload(
            event,
            storageRoot,
            {...NO_LIMITS, maxDurationMs: 120_000, minBytesPerSecond: 1024},
            onFileBegin
        );

        // Barriered like the two rejection tests above. Before this, the watchdog installed after the
        // last advancement and the rate floor was never evaluated at all — the test passed while
        // verifying nothing about the bounds it exists to check.
        await startFileAndAwaitWatchdog(request, begun);

        /*
         * This test asserts a negative — that neither bound fires — which is the one assertion that
         * depends on the byte counter keeping pace with the clock. So the whole payload is pushed and
         * provably consumed before fake time crosses the grace period, rather than being interleaved
         * with it: 8 KiB/s is eight times the 1 KiB/s floor, but only if the bytes are actually on the
         * books when the floor is first evaluated.
         */
        const seconds = UPLOAD_RATE_GRACE_MS / 1_000 + 5;
        const chunk = Buffer.alloc(8 * 1024, "x");

        for (let second = 0; second < seconds; second += 1) {
            request.push(chunk);
        }

        await pumpUntilConsumed(request);

        // Now time can cross the grace period safely: throughput is already well above the floor, and
        // the elapsed total stays under the 120s ceiling.
        await vi.advanceTimersByTimeAsync(UPLOAD_RATE_GRACE_MS + 5_000);

        request.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
        request.complete = true;
        request.push(null);

        const parsed = await parsing;

        expect(parseUploadFields.bind(null, parsed)).toThrow(); // no email field was sent
        expect(Object.keys(parsed.files)).toEqual(["file"]);
    });
});

/*
 * A formidable error as the endpoints actually receive it: an Error carrying the library's internal
 * numeric `code`. Built here rather than imported so the mapping is pinned to the real values.
 */
const formidableError = (message: string, code: number, httpCode = 500) =>
    Object.assign(new Error(message), {code, httpCode});

describe("upload request error classification", () => {
    it("reports a malformed multipart body as a client error, not a server fault", () => {
        const fault = classifyUploadRequestError(
            formidableError("stream ended unexpectedly", formidableErrors.malformedMultipart, 400)
        );

        expect(fault?.statusCode).toBe(400);
        expect(fault?.code).toBe("INVALID_UPLOAD");
    });

    it("reports an aborted upload as a client error even though formidable calls it a 500", () => {
        // formidable constructs its `aborted` error with the default httpCode 500, so matching on
        // httpCode would leave every cancelled or timed-out upload looking like a crash.
        const aborted = formidableError("Request aborted", formidableErrors.aborted, 500);

        expect(classifyUploadRequestError(aborted)?.statusCode).toBe(408);
        expect(classifyUploadRequestError(aborted)?.code).toBe("UPLOAD_ABORTED");
    });

    it("maps each upload bound to a timeout and a vanished client to a bad request", () => {
        for (const reason of ["idle-timeout", "time-limit", "rate-floor"] as const) {
            const fault = classifyUploadRequestError(new UploadAbortedError(reason, reason));

            expect(fault?.statusCode).toBe(408);
            expect(fault?.code).toBe("UPLOAD_ABORTED");
        }

        const closed = classifyUploadRequestError(new UploadAbortedError("client-closed", "gone"));

        expect(closed?.statusCode).toBe(400);
        expect(closed?.code).toBe("UPLOAD_ABORTED");
    });

    it("still reports an oversized file as 413", () => {
        expect(
            classifyUploadRequestError(
                formidableError(
                    "options.maxFileSize exceeded",
                    formidableErrors.biggerThanMaxFileSize,
                    413
                )
            )?.statusCode
        ).toBe(413);
    });

    it("leaves genuine server faults unmapped so they stay 500s", () => {
        // The whole point of classifying by known code: a real server-side failure must not be
        // laundered into a 4xx that hides a bug.
        expect(
            classifyUploadRequestError(
                formidableError("cannot create dir", formidableErrors.cannotCreateDir, 500)
            )
        ).toBeNull();
        expect(classifyUploadRequestError(new Error("database is locked"))).toBeNull();
        expect(classifyUploadRequestError("not even an error")).toBeNull();
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
