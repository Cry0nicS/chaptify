// Served at GET /sitemap.xml. Lists only the public, indexable pages; API and download routes are
// intentionally excluded. Absolute URLs are built from the configured NUXT_SITE_URL (siteUrl).
const PAGES = [
    {path: "/", changefreq: "weekly", priority: "1.0"},
    {path: "/convert", changefreq: "weekly", priority: "0.9"},
    {path: "/about", changefreq: "monthly", priority: "0.5"},
    {path: "/contact", changefreq: "monthly", priority: "0.5"}
];

export default defineEventHandler((event) => {
    const config = useRuntimeConfig(event);
    const origin = (config.siteUrl || "").replace(/\/+$/, "");

    const urls = PAGES.map(
        (page) =>
            `    <url><loc>${origin}${page.path}</loc>` +
            `<changefreq>${page.changefreq}</changefreq>` +
            `<priority>${page.priority}</priority></url>`
    ).join("\n");

    setHeader(event, "content-type", "application/xml; charset=utf-8");

    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
});
