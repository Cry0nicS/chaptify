import type {H3Event} from "h3";

interface WindowCounter {
    count: number;
    resetAt: number;
}

/**
 * Hard ceiling on distinct keys tracked per counter map.
 *
 * The counters are single-process abuse dampeners, not distributed limits. Bounding the map size
 * keeps a flood of unique keys (for example spoofed or rapidly-rotating client identities) from
 * growing memory without limit. Roughly 50k keys per map is a few MB, which is safe on the small
 * single-VPS target while remaining far larger than any legitimate client population.
 */
const MAX_TRACKED_KEYS = 50_000;

/**
 * Minimum spacing between full expired-entry sweeps of a counter map.
 *
 * Sweeping is driven by traffic rather than a background timer, so an idle process does no work and
 * never keeps the event loop alive. A busy process prunes stale windows at most once per interval.
 */
const SWEEP_INTERVAL_MS = 60_000;

const uploadCounters = new Map<string, WindowCounter>();
const jobCounters = new Map<string, WindowCounter>();
const downloadCounters = new Map<string, WindowCounter>();
const lastSweepAt = new WeakMap<Map<string, WindowCounter>, number>();

let activeUploads = 0;

const pruneExpired = (counters: Map<string, WindowCounter>, now: number) => {
    for (const [key, counter] of counters) {
        if (counter.resetAt <= now) {
            counters.delete(key);
        }
    }

    lastSweepAt.set(counters, now);
};

/**
 * Keeps a counter map from growing without bound before a new key is inserted.
 *
 * Expired windows are swept on a coarse interval so steady traffic stays cheap. If the map is still
 * at the hard cap after sweeping (a genuine flood of live windows), the oldest-inserted entries are
 * evicted so memory stays bounded rather than allowing an out-of-memory crash.
 */
const enforceBounds = (counters: Map<string, WindowCounter>, now: number) => {
    if (now - (lastSweepAt.get(counters) ?? 0) >= SWEEP_INTERVAL_MS) {
        pruneExpired(counters, now);
    }

    if (counters.size < MAX_TRACKED_KEYS) {
        return;
    }

    pruneExpired(counters, now);

    for (const key of counters.keys()) {
        if (counters.size < MAX_TRACKED_KEYS) {
            break;
        }

        counters.delete(key);
    }
};

const incrementWindow = (
    counters: Map<string, WindowCounter>,
    key: string,
    limit: number,
    windowMs: number
): boolean => {
    const now = Date.now();
    const current = counters.get(key);

    if (!current || current.resetAt <= now) {
        enforceBounds(counters, now);
        counters.set(key, {count: 1, resetAt: now + windowMs});
        return true;
    }

    if (current.count >= limit) {
        return false;
    }

    current.count += 1;
    return true;
};

const stripZoneId = (value: string): string => {
    const zoneIndex = value.indexOf("%");

    return zoneIndex === -1 ? value : value.slice(0, zoneIndex);
};

/**
 * Normalizes an address so peer, header, and trust-list comparisons use the same form.
 *
 * IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1`) collapse to their IPv4 form, IPv6 zone suffixes
 * are dropped, and casing is unified so header-supplied values match configured trust entries.
 */
const normalizeIp = (value: string): string => {
    const trimmed = stripZoneId(value.trim());
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);

    if (mapped?.[1]) {
        return mapped[1];
    }

    return trimmed.toLowerCase();
};

interface ParsedIp {
    value: bigint;
    bits: 32 | 128;
}

const ipv4ToBigInt = (ip: string): bigint | null => {
    const parts = ip.split(".");

    if (parts.length !== 4) {
        return null;
    }

    let result = 0n;

    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) {
            return null;
        }

        const octet = Number(part);

        if (octet > 255) {
            return null;
        }

        result = (result << 8n) | BigInt(octet);
    }

    return result;
};

const ipv6ToBigInt = (ip: string): bigint | null => {
    let text = ip;

    // An IPv6 address may embed a trailing dotted-quad (a:b:...:1.2.3.4). Fold it into two groups.
    if (text.includes(".")) {
        const lastColon = text.lastIndexOf(":");
        const embedded = ipv4ToBigInt(text.slice(lastColon + 1));

        if (embedded === null) {
            return null;
        }

        const hex = embedded.toString(16).padStart(8, "0");
        text = `${text.slice(0, lastColon + 1)}${hex.slice(0, 4)}:${hex.slice(4)}`;
    }

    const halves = text.split("::");

    if (halves.length > 2) {
        return null;
    }

    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const padding = Array.from({length: 8 - head.length - tail.length}).fill("0") as string[];
    const groups = halves.length === 2 ? [...head, ...padding, ...tail] : head;

    if (groups.length !== 8) {
        return null;
    }

    let result = 0n;

    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(group)) {
            return null;
        }

        result = (result << 16n) | BigInt(Number.parseInt(group, 16));
    }

    return result;
};

const parseIp = (ip: string): ParsedIp | null => {
    if (ip.includes(":")) {
        const value = ipv6ToBigInt(ip);

        return value === null ? null : {value, bits: 128};
    }

    const value = ipv4ToBigInt(ip);

    return value === null ? null : {value, bits: 32};
};

/**
 * Tests whether a normalized IP matches a single trust-list entry.
 *
 * Entries may be an exact IPv4/IPv6 address or an IPv4/IPv6 CIDR block. Comparison is numeric, so
 * differing textual forms of the same IPv6 address still match, and an entry of a different family
 * from the candidate never matches.
 */
const matchesTrustEntry = (normalizedIp: string, entry: string): boolean => {
    const trimmed = entry.trim();

    if (!trimmed) {
        return false;
    }

    const candidate = parseIp(normalizedIp);

    if (!candidate) {
        return false;
    }

    const slashIndex = trimmed.indexOf("/");

    if (slashIndex === -1) {
        const exact = parseIp(normalizeIp(trimmed));

        return Boolean(exact) && exact!.bits === candidate.bits && exact!.value === candidate.value;
    }

    const network = parseIp(normalizeIp(trimmed.slice(0, slashIndex)));
    const prefix = Number(trimmed.slice(slashIndex + 1));

    if (
        !network ||
        network.bits !== candidate.bits ||
        !Number.isInteger(prefix) ||
        prefix < 0 ||
        prefix > network.bits
    ) {
        return false;
    }

    if (prefix === 0) {
        return true;
    }

    const mask = ((1n << BigInt(network.bits)) - 1n) ^ ((1n << BigInt(network.bits - prefix)) - 1n);

    return (candidate.value & mask) === (network.value & mask);
};

type TrustPolicy = {mode: "none"} | {mode: "all"} | {mode: "list"; entries: string[]};

const parseTrustPolicy = (trustProxy: string): TrustPolicy => {
    const value = trustProxy.trim().toLowerCase();

    if (!value || value === "false" || value === "0" || value === "off") {
        return {mode: "none"};
    }

    if (value === "true" || value === "1" || value === "on") {
        return {mode: "all"};
    }

    return {
        mode: "list",
        entries: trustProxy
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
    };
};

/**
 * Resolves the client identity used to key every per-IP abuse control.
 *
 * The direct socket peer is authoritative by default; forwarded headers are consulted only when the
 * operator has explicitly declared a trusted-proxy policy via `trustProxy`. This prevents an
 * unauthenticated client from forging its rate-limit identity through a spoofed header.
 *
 * - `""`/`false` (default): trust nothing but the connection; return the socket peer.
 * - `true`: single trusted proxy; return the right-most `X-Forwarded-For` hop (the client as seen
 *   by that proxy), falling back to the peer.
 * - CIDR/IP list: only when the peer is a listed proxy, walk `X-Forwarded-For` right-to-left and
 *   return the first hop that is not itself a trusted proxy — the real client, immune to injected
 *   left-most entries.
 */
export const getClientIp = (event: H3Event, trustProxy = ""): string => {
    const socketIp = normalizeIp(event.node.req.socket?.remoteAddress || "") || "unknown";
    const policy = parseTrustPolicy(trustProxy);

    if (policy.mode === "none") {
        return socketIp;
    }

    const forwarded = (getHeader(event, "x-forwarded-for") || "")
        .split(",")
        .map((part) => normalizeIp(part))
        .filter(Boolean);

    if (policy.mode === "all") {
        return forwarded.at(-1) || socketIp;
    }

    const isTrusted = (ip: string) => policy.entries.some((entry) => matchesTrustEntry(ip, entry));

    if (!isTrusted(socketIp)) {
        return socketIp;
    }

    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
        const candidate = forwarded[index];

        if (candidate && !isTrusted(candidate)) {
            return candidate;
        }
    }

    return forwarded[0] || socketIp;
};

export const tryAcquireUploadSlot = (limit: number): boolean => {
    if (activeUploads >= limit) {
        return false;
    }

    activeUploads += 1;
    return true;
};

export const releaseUploadSlot = () => {
    activeUploads = Math.max(0, activeUploads - 1);
};

export const checkUploadRateLimit = (ip: string, limit: number, windowMs: number): boolean =>
    incrementWindow(uploadCounters, ip, limit, windowMs);

export const checkJobCreationLimit = (ip: string, limit: number, windowMs: number): boolean =>
    incrementWindow(jobCounters, ip, limit, windowMs);

export const checkDownloadRateLimit = (ip: string, limit: number, windowMs: number): boolean =>
    incrementWindow(downloadCounters, ip, limit, windowMs);

export const resetRateLimitsForTests = () => {
    uploadCounters.clear();
    jobCounters.clear();
    downloadCounters.clear();
    activeUploads = 0;
};
