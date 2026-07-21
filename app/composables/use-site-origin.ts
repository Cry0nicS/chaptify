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
        const configured = (config.siteUrl || "").replace(/\/+$/, "");

        if (configured) {
            return configured;
        }

        return import.meta.client ? window.location.origin : "";
    });
};
