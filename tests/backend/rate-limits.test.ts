import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

import {checkUploadRateLimit, getClientIp} from "../../server/utils/backend/rate-limits";

import {registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

interface FakeRequestEvent {
    __headers: Record<string, string>;
}

const makeIpEvent = (remoteAddress: string | undefined, headers: Record<string, string> = {}) =>
    ({
        node: {req: {socket: {remoteAddress}}},
        __headers: Object.fromEntries(
            Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
        )
    }) as unknown as Parameters<typeof getClientIp>[0];

describe("client IP resolution and rate limiting", () => {
    const globalWithHeader = globalThis as {getHeader?: unknown};
    const originalGetHeader = globalWithHeader.getHeader;

    beforeAll(() => {
        globalWithHeader.getHeader = (event: unknown, name: string) =>
            (event as FakeRequestEvent).__headers?.[name.toLowerCase()];
    });

    afterAll(() => {
        globalWithHeader.getHeader = originalGetHeader;
    });

    it("ignores forwarded headers by default so identities cannot be spoofed", () => {
        const event = makeIpEvent("203.0.113.7", {"x-forwarded-for": "1.2.3.4"});

        expect(getClientIp(event, "")).toBe("203.0.113.7");
        expect(getClientIp(event, "false")).toBe("203.0.113.7");
    });

    it("does not trust X-Forwarded-For from a direct (untrusted) peer", () => {
        const event = makeIpEvent("198.51.100.9", {"x-forwarded-for": "10.0.0.1, 8.8.8.8"});

        expect(getClientIp(event, "127.0.0.1,::1")).toBe("198.51.100.9");
    });

    it("resolves the real client behind a trusted loopback proxy", () => {
        const event = makeIpEvent("127.0.0.1", {"x-forwarded-for": "203.0.113.20"});

        expect(getClientIp(event, "127.0.0.1")).toBe("203.0.113.20");
    });

    it("walks past chained trusted proxies to the first untrusted hop", () => {
        const event = makeIpEvent("10.0.0.2", {
            "x-forwarded-for": "5.5.5.5, 203.0.113.30, 10.0.0.1"
        });

        expect(getClientIp(event, "10.0.0.0/8")).toBe("203.0.113.30");
    });

    it("normalizes IPv4-mapped IPv6 peers against CIDR trust entries", () => {
        const event = makeIpEvent("::ffff:172.16.0.5", {"x-forwarded-for": "203.0.113.40"});

        expect(getClientIp(event, "172.16.0.0/12")).toBe("203.0.113.40");
    });

    it("trusts the immediate hop in single-proxy (true) mode", () => {
        const event = makeIpEvent("10.9.9.9", {"x-forwarded-for": "203.0.113.50"});

        expect(getClientIp(event, "true")).toBe("203.0.113.50");
    });

    it("in single-proxy (true) mode takes the right-most hop, ignoring injected left-most entries", () => {
        // Defense in depth: our Caddy overwrites X-Forwarded-For with a single sanitized hop in
        // production, but if any multi-hop value reaches the app, `true` must key on the right-most
        // (proxy-attested) client and never an injected left-most entry.
        const event = makeIpEvent("10.9.9.9", {
            "x-forwarded-for": "1.2.3.4, 9.9.9.9, 203.0.113.50"
        });

        expect(getClientIp(event, "true")).toBe("203.0.113.50");
    });

    it("matches IPv6 CIDR and exact trust entries across textual forms", () => {
        const cidrPeer = makeIpEvent("2001:db8:0:0:0:0:0:1", {"x-forwarded-for": "203.0.113.60"});
        expect(getClientIp(cidrPeer, "2001:db8::/32")).toBe("203.0.113.60");

        const exactPeer = makeIpEvent("2001:0db8::1", {"x-forwarded-for": "203.0.113.61"});
        expect(getClientIp(exactPeer, "2001:db8::1")).toBe("203.0.113.61");

        // A v4 peer must not match a v6 trust entry (family mismatch) → not trusted → socket peer.
        const v4Peer = makeIpEvent("198.51.100.10", {"x-forwarded-for": "203.0.113.62"});
        expect(getClientIp(v4Peer, "2001:db8::/32")).toBe("198.51.100.10");
    });

    it("enforces the per-key upload window and isolates distinct keys", () => {
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(true);
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(true);
        expect(checkUploadRateLimit("192.0.2.50", 2, 60_000)).toBe(false);
        expect(checkUploadRateLimit("192.0.2.51", 2, 60_000)).toBe(true);
    });
});
