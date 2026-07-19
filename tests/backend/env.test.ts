import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {getBackendConfigFromEnv} from "../../server/utils/backend/config";

import {loadDotenv, parseDotenv} from "../../server/utils/backend/env";

import {registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("runtime environment loading", () => {
    it("parses dotenv values and ignores comments", () => {
        expect(
            parseDotenv(`
                # comment
                NUXT_MAILGUN_DOMAIN=mg.example.test
                NUXT_MAILGUN_KEY="key-test"
                NUXT_MAILGUN_SENDER='Chaptify <sender@example.test>'
                export NUXT_MAILGUN_BCC=bcc@example.test # optional recipient
            `)
        ).toEqual({
            NUXT_MAILGUN_DOMAIN: "mg.example.test",
            NUXT_MAILGUN_KEY: "key-test",
            NUXT_MAILGUN_SENDER: "Chaptify <sender@example.test>",
            NUXT_MAILGUN_BCC: "bcc@example.test"
        });
    });

    it("loads Mailgun values from .env without overriding shell values", async () => {
        const root = await mkdtemp(join(tmpdir(), "chaptify-env-"));
        await writeFile(
            join(root, ".env"),
            [
                "NUXT_SITE_URL=https://example.test",
                "NUXT_STORAGE_ROOT=/tmp/chaptify",
                "NUXT_MAILGUN_BASE_URL=https://api.mailgun.test",
                "NUXT_MAILGUN_DOMAIN=mg.example.test",
                "NUXT_MAILGUN_KEY=key-from-file",
                "NUXT_MAILGUN_SENDER=sender@example.test"
            ].join("\n")
        );
        const env: NodeJS.ProcessEnv = {
            NUXT_MAILGUN_KEY: "key-from-shell"
        };

        loadDotenv(root, env);

        expect(env.NUXT_SITE_URL).toBe("https://example.test");
        expect(env.NUXT_MAILGUN_KEY).toBe("key-from-shell");
        expect(env.NUXT_MAILGUN_DOMAIN).toBe("mg.example.test");
    });

    it("keeps getBackendConfigFromEnv aligned with loaded Mailgun config", async () => {
        const root = await mkdtemp(join(tmpdir(), "chaptify-env-"));
        await writeFile(
            join(root, ".env"),
            [
                "NUXT_SITE_URL=https://example.test",
                "NUXT_STORAGE_ROOT=/tmp/chaptify",
                "NUXT_MAILGUN_BASE_URL=https://api.mailgun.test",
                "NUXT_MAILGUN_DOMAIN=mg.example.test",
                "NUXT_MAILGUN_KEY=key-test",
                "NUXT_MAILGUN_SENDER=sender@example.test"
            ].join("\n")
        );
        const previousEnv = {...process.env};

        try {
            process.env = {};
            loadDotenv(root);

            expect(getBackendConfigFromEnv()).toMatchObject({
                siteUrl: "https://example.test",
                mailgunBaseUrl: "https://api.mailgun.test",
                mailgunDomain: "mg.example.test",
                mailgunKey: "key-test",
                mailgunSender: "sender@example.test"
            });
        } finally {
            process.env = previousEnv;
        }
    });
});
