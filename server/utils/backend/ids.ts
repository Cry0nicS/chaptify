import {createHash, randomBytes} from "node:crypto";

export const createPublicId = (): string => randomBytes(18).toString("base64url");

export const createInternalId = (): string => randomBytes(16).toString("hex");

export const createDownloadToken = (): string => randomBytes(32).toString("base64url");

export const createBrowserJobAccessToken = (): string => randomBytes(32).toString("base64url");

export const hashDownloadToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

export const hashBrowserJobAccessToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");
