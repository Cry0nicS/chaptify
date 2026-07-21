import {normalizeOrigin} from "#shared/utils/helpers";

// Served at GET /robots.txt. Allows crawling of the public pages, blocks the API surface, and
// points crawlers at the sitemap using the configured NUXT_SITE_URL (siteUrl).
export default defineEventHandler((event) => {
    const config = useRuntimeConfig(event);
    const origin = normalizeOrigin(config.siteUrl);

    setHeader(event, "content-type", "text/plain; charset=utf-8");

    return [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        `Sitemap: ${origin}/sitemap.xml`,
        ""
    ].join("\n");
});
