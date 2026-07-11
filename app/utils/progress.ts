export const clampProgress = (value: number | null | undefined): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }

    return Math.min(100, Math.max(0, Math.round(value)));
};

export const monotonicProgress = (previous: number, next: number | null | undefined): number =>
    Math.max(clampProgress(previous), clampProgress(next));

export const displayProcessingProgress = (
    status: "queued" | "processing" | "ready" | "failed" | "expired",
    previous: number,
    next: number | null | undefined
): number => {
    if (status === "ready" || status === "failed" || status === "expired") {
        return clampProgress(next);
    }

    return Math.min(99, monotonicProgress(previous, next));
};

export const hasChapterProgress = (
    currentChapter: number | null | undefined,
    totalChapters: number | null | undefined
): currentChapter is number => {
    if (
        typeof currentChapter !== "number" ||
        typeof totalChapters !== "number" ||
        !Number.isInteger(currentChapter) ||
        !Number.isInteger(totalChapters)
    ) {
        return false;
    }

    return currentChapter >= 0 && totalChapters > 0 && currentChapter <= totalChapters;
};
