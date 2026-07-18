import type {Server} from "node:http";

/**
 * Tunes the underlying Node HTTP server timeouts once the server is reachable.
 *
 * Node's default `requestTimeout` (300s) would abort a large but legitimate audiobook upload on a
 * slow link regardless of progress. The anti-slowloris control for the request body is the
 * per-request idle timeout in `POST /api/jobs` (`NUXT_UPLOAD_IDLE_TIMEOUT_SECONDS`), so the total
 * request timeout is disabled here while `headersTimeout` still bounds a stalled header phase.
 *
 * Nitro does not expose the raw server instance to plugins, so it is read from the first request's
 * socket and configured a single time.
 */
const HEADERS_TIMEOUT_MS = 60_000;

let configured = false;

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook("request", (event) => {
        if (configured) {
            return;
        }

        const socket = event.node.req.socket as typeof event.node.req.socket & {server?: Server};
        const server = socket?.server;

        if (!server) {
            return;
        }

        configured = true;
        server.headersTimeout = HEADERS_TIMEOUT_MS;
        server.requestTimeout = 0;
    });
});
