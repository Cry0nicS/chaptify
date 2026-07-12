import {lstat, rm} from "node:fs/promises";
import {basename, join, resolve, sep} from "node:path";

const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_FILENAME_CHARACTERS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

const replaceUnsafeFilenameCharacters = (value: string): string =>
    [...value]
        .map((character) => {
            const code = character.charCodeAt(0);

            return code < 32 || code === 127 || UNSAFE_FILENAME_CHARACTERS.has(character)
                ? " "
                : character;
        })
        .join("");

export const sanitizeDisplayFilename = (name: string): string => {
    const base = replaceUnsafeFilenameCharacters(basename(name || "audiobook"));
    const normalized = base
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");

    if (!normalized || WINDOWS_RESERVED_NAMES.test(normalized)) {
        return "audiobook";
    }

    return normalized.slice(0, 120);
};

export const sanitizeChapterTitle = (
    title: string | null | undefined,
    fallback: string
): string => {
    const value = replaceUnsafeFilenameCharacters(title || fallback);
    const normalized = value
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");
    const safe = normalized && !WINDOWS_RESERVED_NAMES.test(normalized) ? normalized : fallback;

    return safe.slice(0, 90);
};

export const buildChapterFilenames = (
    titles: Array<string | null | undefined>,
    extension: "mp3" | "m4a"
): string[] => {
    const width = Math.max(2, String(titles.length).length);
    const seen = new Map<string, number>();

    return titles.map((title, index) => {
        const prefix = String(index + 1).padStart(width, "0");
        const baseTitle = sanitizeChapterTitle(title, `Chapter ${prefix}`);
        const duplicateCount = seen.get(baseTitle) || 0;
        seen.set(baseTitle, duplicateCount + 1);
        const dedupedTitle =
            duplicateCount > 0 ? `${baseTitle} (${duplicateCount + 1})` : baseTitle;

        return `${prefix} - ${dedupedTitle}.${extension}`;
    });
};

/**
 * Resolves a candidate path and rejects anything outside the private storage root.
 *
 * Every file operation that touches uploads, generated chapters, ZIPs, or cleanup targets should
 * pass through this guard so job-controlled names cannot escape via traversal or absolute paths.
 */
export const ensurePathInside = (root: string, candidate: string): string => {
    const resolvedRoot = resolve(root);
    const resolvedCandidate = resolve(candidate);

    if (
        resolvedCandidate !== resolvedRoot &&
        !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
    ) {
        throw new Error("Path escapes storage root");
    }

    return resolvedCandidate;
};

export const jobDirectory = (storageRoot: string, internalId: string): string =>
    ensurePathInside(storageRoot, join(storageRoot, "jobs", internalId));

/**
 * Deletes a storage-root-contained path without following directory symlinks.
 *
 * Cleanup is intentionally idempotent: missing paths are treated as already removed, and symlinks
 * are unlinked directly rather than traversed.
 */
export const safeRemoveInside = async (storageRoot: string, target: string): Promise<void> => {
    const safeTarget = ensurePathInside(storageRoot, target);

    try {
        const stats = await lstat(safeTarget);

        if (stats.isSymbolicLink()) {
            await rm(safeTarget, {force: true});
            return;
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
        }

        throw error;
    }

    await rm(safeTarget, {force: true, recursive: true});
};
