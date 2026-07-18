import type {Server} from "node:http";

/**
 * Tunes the underlying Node HTTP server timeouts and connection cap once it is reachable.
 *
 * Node's default `requestTimeout` (300s) would abort a large but legitimate audiobook upload on a
 * slow link regardless of progress, so it is disabled. To keep that from reopening a slowloris hole
 * on request bodies, the two body-bearing routes bound their own body phase (`POST /api/jobs` via
 * `NUXT_UPLOAD_IDLE_TIMEOUT_SECONDS`, `POST /api/jobs/:id/download` via an explicit read timeout),
 * `headersTimeout` bounds a stalled header phase, and `maxConnections` caps how many connections a
 * flood can hold open at once.
 *
 * Nitro does not expose the raw server instance to plugins, so it is read from the first request's
 * socket and configured a single time.
 */
const HEADERS_TIMEOUT_MS = 60_000;
const MAX_CONNECTIONS = 512;

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
        server.maxConnections = MAX_CONNECTIONS;
    });
});
