import type {H3Event} from "h3";

interface WindowCounter {
    count: number;
    resetAt: number;
}

const uploadCounters = new Map<string, WindowCounter>();
const jobCounters = new Map<string, WindowCounter>();
const downloadCounters = new Map<string, WindowCounter>();

let activeUploads = 0;

const incrementWindow = (
    counters: Map<string, WindowCounter>,
    key: string,
    limit: number,
    windowMs: number
): boolean => {
    const now = Date.now();
    const current = counters.get(key);

    if (!current || current.resetAt <= now) {
        counters.set(key, {count: 1, resetAt: now + windowMs});
        return true;
    }

    if (current.count >= limit) {
        return false;
    }

    current.count += 1;
    return true;
};

export const getClientIp = (event: H3Event): string => {
    const forwarded = getHeader(event, "cf-connecting-ip") || "";
    const remote = event.node.req.socket.remoteAddress || "unknown";

    return forwarded && remote.startsWith("127.") ? forwarded : remote;
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
