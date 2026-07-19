import {afterEach, describe, expect, it, vi} from "vitest";
import {validateProductionConfig} from "../../server/utils/backend/config";

import {makeConfig, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("production config validation", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it("is a no-op outside production even with unsafe values", () => {
        process.env.NODE_ENV = "development";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                downloadSigningSecret: "",
                mailgunKey: "",
                siteUrl: "http://localhost:3000"
            })
        ).not.toThrow();
    });

    it("throws in production when required values are missing or unsafe", () => {
        process.env.NODE_ENV = "production";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                downloadSigningSecret: "",
                siteUrl: "http://localhost:3000"
            })
        ).toThrow(/NUXT_DOWNLOAD_SIGNING_SECRET/);
    });

    it("passes in production when all required values are set", () => {
        process.env.NODE_ENV = "production";

        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                siteUrl: "https://chaptify.example"
            })
        ).not.toThrow();
    });

    it("treats a localhost app origin as a warning, not a fatal error", () => {
        process.env.NODE_ENV = "production";

        // The API/cleanup processes (and containerized smoke tests) must still boot on localhost.
        expect(() =>
            validateProductionConfig({
                ...makeConfig("."),
                siteUrl: "http://localhost:3000"
            })
        ).not.toThrow();
    });

    it("requires Mailgun only when requireMailgun is set (worker)", () => {
        process.env.NODE_ENV = "production";
        const withoutMailgun = {
            ...makeConfig("."),
            siteUrl: "https://chaptify.example",
            mailgunKey: "",
            mailgunDomain: "",
            mailgunSender: "",
            mailgunBaseUrl: ""
        };

        // API/cleanup: Mailgun not required.
        expect(() => validateProductionConfig(withoutMailgun)).not.toThrow();
        // Worker: Mailgun required.
        expect(() => validateProductionConfig(withoutMailgun, {requireMailgun: true})).toThrow(
            /NUXT_MAILGUN_KEY/
        );
    });
});
