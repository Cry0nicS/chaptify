import type {BackendConfig} from "./config";
import Mailgun from "mailgun.js";

export interface MailgunSendInput {
    to: string;
    downloadUrl: string;
    expiresInHours: number;
}

const maskEmail = (email: string): string => {
    const [local, domain] = email.split("@");

    return `${local?.slice(0, 2) || "**"}***@${domain || "***"}`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error("Mailgun request timed out"));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};

/**
 * Creates the Mailgun adapter used by the worker after ZIP finalization.
 *
 * Delivery errors are rethrown with a masked recipient because logs must not contain full email
 * addresses, credentials, or temporary download links. The worker decides retry and status rules.
 */
export const createMailgunService = (config: BackendConfig) => {
    const isConfigured = Boolean(
        config.mailgunKey && config.mailgunDomain && config.mailgunSender && config.mailgunBaseUrl
    );
    const client = isConfigured
        ? new Mailgun(FormData).client({
              username: "api",
              key: config.mailgunKey,
              url: config.mailgunBaseUrl
          })
        : null;

    return {
        async sendCompletionEmail(input: MailgunSendInput): Promise<void> {
            if (!client || !config.mailgunSender) {
                throw new Error("Mailgun is not configured");
            }

            const bcc = config.mailgunBcc || undefined;
            const text = [
                "Your audiobook is ready.",
                "",
                "Processing completed successfully. Download your chapter archive here:",
                input.downloadUrl,
                "",
                `This link expires in ${input.expiresInHours} hours.`,
                "The file will be deleted automatically after expiration."
            ].join("\n");
            const html = [
                "<p>Your audiobook is ready.</p>",
                "<p>Processing completed successfully.</p>",
                `<p><a href="${input.downloadUrl}">Download your chapter archive</a></p>`,
                `<p>This link expires in ${input.expiresInHours} hours.</p>`,
                "<p>The file will be deleted automatically after expiration.</p>"
            ].join("");

            try {
                await withTimeout(
                    client.messages.create(config.mailgunDomain, {
                        from: config.mailgunSender,
                        to: input.to,
                        ...(bcc ? {bcc} : {}),
                        subject: "Your Chaptify audiobook is ready",
                        text,
                        html
                    }),
                    15_000
                );
            } catch (error) {
                throw new Error(
                    `Mailgun delivery failed for ${maskEmail(input.to)}: ${String(error)}`
                );
            }
        }
    };
};
