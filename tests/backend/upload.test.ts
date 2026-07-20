import type {H3Event} from "h3";
import {Buffer} from "node:buffer";
import {Readable} from "node:stream";
import {describe, expect, it} from "vitest";
import {
    parseMultipartUpload,
    parseUploadFields,
    UPLOAD_FIELD_NAMES
} from "../../server/utils/backend/upload-request";
import {makeStorageRoot, registerBackendTestHooks} from "./helpers";

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

const parse = async (fields: Array<[string, string]>) => {
    const storageRoot = await makeStorageRoot();

    return parseMultipartUpload(
        makeEvent(buildMultipartBody(fields)),
        storageRoot,
        10_485_760,
        0,
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
