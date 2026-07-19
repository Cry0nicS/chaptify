import {contactRequestSchema} from "../../shared/utils/schemas";
import {getBackendConfig} from "../utils/backend/config";
import {createMailgunService} from "../utils/backend/mailgun";
import {checkContactRateLimit, getClientIp} from "../utils/backend/rate-limits";

/**
 * Total time allowed to receive the small JSON body. Because the server-wide `requestTimeout` is
 * disabled to support large uploads, this route bounds its own body phase so a slow-drip client
 * cannot hold the connection open indefinitely.
 */
const BODY_READ_TIMEOUT_MS = 10_000;

/** Sliding window for the per-IP contact limit (`contactRateLimit` messages per hour). */
const CONTACT_RATE_WINDOW_MS = 60 * 60 * 1000;

const invalidRequestError = () =>
    createError({
        statusCode: 400,
        statusMessage: "Invalid contact request",
        data: {
            error: {
                code: "INVALID_CONTACT_REQUEST",
                message: "Check the form fields and try again."
            }
        }
    });

/**
 * POST /api/contact validates a contact-form submission and forwards it to the operator inbox.
 *
 * The email goes to `NUXT_CONTACT_RECIPIENT` via Mailgun with the sender's address as Reply-To.
 * Nothing is persisted; if Mailgun is unreachable or unconfigured the client gets a generic
 * failure without provider diagnostics.
 */
export default defineEventHandler(async (event) => {
    const config = getBackendConfig();

    if (
        !checkContactRateLimit(
            getClientIp(event, config.trustProxy),
            config.contactRateLimit,
            CONTACT_RATE_WINDOW_MS
        )
    ) {
        throw createError({
            statusCode: 429,
            statusMessage: "Too many contact requests",
            data: {
                error: {
                    code: "CONTACT_RATE_LIMITED",
                    message: "You have sent several messages recently. Please try again later."
                }
            }
        });
    }

    const request = event.node.req;
    const bodyTimer = setTimeout(
        () => request.destroy(new Error("Contact request body timed out")),
        BODY_READ_TIMEOUT_MS
    );
    let rawBody: unknown;
    try {
        rawBody = await readBody(event);
    } catch {
        throw invalidRequestError();
    } finally {
        clearTimeout(bodyTimer);
    }

    const parsedBody = contactRequestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
        throw invalidRequestError();
    }

    const mailgun = createMailgunService(config);

    try {
        await mailgun.sendContactEmail({
            name: parsedBody.data.name,
            replyTo: parsedBody.data.email,
            topic: parsedBody.data.topic,
            message: parsedBody.data.message
        });
    } catch (error) {
        // The thrown message is already masked; keep provider details out of the response.
        console.error(`Contact email failed: ${String(error)}`);
        throw createError({
            statusCode: 502,
            statusMessage: "Contact delivery failed",
            data: {
                error: {
                    code: "CONTACT_DELIVERY_FAILED",
                    message: "Your message could not be sent right now. Please try again later."
                }
            }
        });
    }

    return {status: "sent" as const};
});
