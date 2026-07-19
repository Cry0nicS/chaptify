import {describe, expect, it, vi} from "vitest";

import {createMailgunService} from "../../server/utils/backend/mailgun";

import {contactRequestSchema} from "../../shared/utils/schemas";
import {makeConfig, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("contact form", () => {
    it("accepts a valid submission and trims free-text fields", () => {
        const parsed = contactRequestSchema.parse({
            name: "  Adrian  ",
            email: "runner@example.test",
            topic: "feature",
            message: "  The waveform looks great, but M4B chapters with umlauts fail.  "
        });

        expect(parsed.name).toBe("Adrian");
        expect(parsed.message).toBe(
            "The waveform looks great, but M4B chapters with umlauts fail."
        );
    });

    it("rejects invalid submissions", () => {
        const base = {
            name: "Adrian",
            email: "runner@example.test",
            topic: "bug",
            message: "Something broke while splitting my audiobook."
        };

        expect(contactRequestSchema.safeParse({...base, email: "not-an-email"}).success).toBe(
            false
        );
        expect(contactRequestSchema.safeParse({...base, topic: undefined}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, topic: "spam"}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, topic: ["bug"]}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, message: "short"}).success).toBe(false);
        expect(contactRequestSchema.safeParse({...base, name: ""}).success).toBe(false);
    });

    it("sends a text-only contact email to the operator with Reply-To", async () => {
        const mocked = await import("mailgun.js");
        const create = Reflect.get(mocked, "__mailgunCreate") as ReturnType<typeof vi.fn>;
        create.mockClear();
        create.mockResolvedValueOnce({});
        const service = createMailgunService(makeConfig("unused-storage-root"));

        await service.sendContactEmail({
            name: "Adrian",
            replyTo: "runner@example.test",
            topic: "feature",
            message: "Please add chapter renaming."
        });

        expect(create).toHaveBeenCalledTimes(1);
        const [domain, payload] = create.mock.calls[0] as [string, Record<string, unknown>];
        expect(domain).toBe("example.test");
        expect(payload.to).toBe("operator@example.test");
        expect(payload["h:Reply-To"]).toBe("runner@example.test");
        expect(payload.subject).toBe("Chaptify contact: Feature suggestion");
        expect(payload.text).toContain("Please add chapter renaming.");
        expect(payload.html).toBeUndefined();
    });

    it("fails without exposing details when the contact recipient is not configured", async () => {
        const service = createMailgunService({
            ...makeConfig("unused-storage-root"),
            contactRecipient: ""
        });

        await expect(
            service.sendContactEmail({
                name: "Adrian",
                replyTo: "runner@example.test",
                topic: "bug",
                message: "Something broke while splitting my audiobook."
            })
        ).rejects.toThrow("Contact recipient is not configured");
    });
});
