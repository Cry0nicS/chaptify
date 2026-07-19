import {describe, expect, it, vi} from "vitest";

import {serializePublicError} from "../../server/utils/backend/errors";

import {
    buildChapterFilenames,
    sanitizeChapterTitle,
    sanitizeDisplayFilename
} from "../../server/utils/backend/paths";

import {uploadMetadataSchema} from "../../shared/utils/schemas";
import {registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("public validation and filenames", () => {
    it("validates submitted email and upload metadata", () => {
        expect(
            uploadMetadataSchema.parse({
                email: "reader@example.test",
                fileName: "book.mp3",
                fileSize: 1,
                extension: "mp3",
                outputFormat: "m4b"
            })
        ).toMatchObject({extension: "mp3", outputFormat: "m4b"});
        expect(() =>
            uploadMetadataSchema.parse({
                email: "not-an-email",
                fileName: "book.wav",
                fileSize: 0,
                extension: "wav"
            })
        ).toThrow();
    });

    it("sanitizes filenames and handles duplicate chapter names deterministically", () => {
        expect(sanitizeDisplayFilename("../CON")).toBe("audiobook");
        expect(sanitizeChapterTitle("Intro/Start", "Chapter 01")).toBe("Intro Start");
        expect(buildChapterFilenames(["Intro", "Intro", ""], "m4b")).toEqual([
            "01 - Intro.m4b",
            "02 - Intro (2).m4b",
            "03 - Chapter 03.m4b"
        ]);
    });

    it("serializes public processing errors without diagnostics", () => {
        expect(serializePublicError("NO_CHAPTERS_FOUND")).toEqual({
            code: "NO_CHAPTERS_FOUND",
            message: "No embedded chapter metadata was found in this audiobook."
        });
    });
});
