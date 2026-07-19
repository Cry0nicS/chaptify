import {describe, expect, it, vi} from "vitest";

import {PublicJobError} from "../../server/utils/backend/errors";

import {validateChapters} from "../../server/utils/backend/media";

import {registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("chapter metadata", () => {
    it("accepts ordered valid chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "One", start: 0, end: 10},
                    {title: "Two", start: 10, end: 20}
                ],
                20
            )
        ).not.toThrow();
    });

    it("rejects invalid chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "Bad", start: 5, end: 4},
                    {title: "Later", start: 4, end: 8}
                ],
                10
            )
        ).toThrow(PublicJobError);
    });

    it("rejects overlapping chapter ranges", () => {
        expect(() =>
            validateChapters(
                [
                    {title: "One", start: 0, end: 10},
                    {title: "Two", start: 9, end: 20}
                ],
                20
            )
        ).toThrow(PublicJobError);
    });
});
