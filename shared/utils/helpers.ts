/** Trims trailing slashes from a configured site URL to produce a clean origin for absolute URLs. */
export const normalizeOrigin = (siteUrl: string | undefined) => (siteUrl || "").replace(/\/+$/, "");

export const getPrettyPrintNow = () =>
    new Date().toLocaleString("de-DE", {
        dateStyle: "medium",
        timeStyle: "short"
    });
