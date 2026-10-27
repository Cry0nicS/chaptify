import {normalizeOrigin} from "#shared/utils/helpers";

/**
 * Resolves the public site origin (scheme + host, no trailing slash) for building absolute SEO
 * URLs (canonical links, og:url, JSON-LD). On the server it reads the configured `NUXT_SITE_URL`
 * (the same value used for emailed links) and hydrates it to the client via `useState`, so the
 * client never needs the value exposed as public runtime config. Falls back to the browser origin
 * if the config is unset.
 */
export const useSiteOrigin = () => {
    const config = useRuntimeConfig();

    return useState<string>("site-origin", () => {
        // `siteUrl` is server-only config. The state is normally hydrated from the server, but it can
        // first be created on the client — after clearing an error page that the server rendered in
        // place of app.vue — and reading it there only logs a warning, so use the browser origin.
        if (import.meta.client) {
            return window.location.origin;
        }

        return normalizeOrigin(config.siteUrl);
    });
};
