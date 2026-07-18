import {getBackendConfig} from "../utils/backend/config";

/**
 * GET /api/ready reports whether the API is fully configured to deliver completion downloads.
 *
 * Liveness (`/api/health`) only proves the process can reach SQLite and storage. In production
 * `validateProductionConfig` already fails startup on missing config, but this readiness probe
 * surfaces an incomplete email-delivery configuration (for example in a partially-configured
 * environment) as a `503` instead of a misleadingly healthy service.
 */
export default defineEventHandler((event) => {
    const config = getBackendConfig();
    const emailDeliveryReady = Boolean(
        config.downloadSigningSecret &&
        config.mailgunKey &&
        config.mailgunDomain &&
        config.mailgunSender &&
        config.mailgunBaseUrl
    );

    if (!emailDeliveryReady) {
        setResponseStatus(event, 503);

        return {status: "not-ready", emailDeliveryReady};
    }

    return {status: "ready", emailDeliveryReady};
});
