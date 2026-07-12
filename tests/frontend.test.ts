import type {JobStatusResponse} from "../shared/utils/types";
import {afterEach, describe, expect, it, vi} from "vitest";
import {effectScope, nextTick} from "vue";
import {ACTIVE_JOB_STORAGE_KEY, useJobStatus} from "../app/composables/use-job-status";
import {useJobUpload} from "../app/composables/use-job-upload";
import {toFrontendApiError} from "../app/utils/api-errors";
import {formatExpiration} from "../app/utils/date-format";
import {validateEmailAddress} from "../app/utils/email";
import {validateAudiobookFile} from "../app/utils/file-validation";
import {formatFileSize} from "../app/utils/format-file-size";
import {
    clampProgress,
    displayProcessingProgress,
    hasChapterProgress,
    monotonicProgress
} from "../app/utils/progress";

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    public get length() {
        return this.values.size;
    }

    public clear() {
        this.values.clear();
    }

    public getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    public key(index: number) {
        return Array.from(this.values.keys())[index] ?? null;
    }

    public removeItem(key: string) {
        this.values.delete(key);
    }

    public setItem(key: string, value: string) {
        this.values.set(key, value);
    }
}

interface FakeProgressEvent {
    lengthComputable: boolean;
    loaded: number;
    total: number;
}

type FakeXhrEventName = "load" | "error" | "abort" | "timeout";
type FakeXhrEventListener = () => void;
type FakeProgressListener = (event: FakeProgressEvent) => void;

class FakeXhrUpload {
    private readonly progressListeners = new Set<FakeProgressListener>();

    public addEventListener(_type: "progress", listener: FakeProgressListener) {
        this.progressListeners.add(listener);
    }

    public removeEventListener(_type: "progress", listener: FakeProgressListener) {
        this.progressListeners.delete(listener);
    }

    public emitProgress(event: FakeProgressEvent) {
        for (const listener of this.progressListeners) {
            listener(event);
        }
    }
}

class FakeXhr {
    public status = 0;
    public responseText = "";
    public timeout = 0;
    public readonly upload = new FakeXhrUpload();
    public sentBody: FormData | null = null;
    public aborted = false;
    private readonly listeners = new Map<FakeXhrEventName, Set<FakeXhrEventListener>>();

    public open(_method: string, _url: string) {}

    public send(body: FormData) {
        this.sentBody = body;
    }

    public abort() {
        this.aborted = true;
        this.emit("abort");
    }

    public addEventListener(type: FakeXhrEventName, listener: FakeXhrEventListener) {
        const listeners = this.listeners.get(type) || new Set<FakeXhrEventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    public removeEventListener(type: FakeXhrEventName, listener: FakeXhrEventListener) {
        this.listeners.get(type)?.delete(listener);
    }

    public emit(type: FakeXhrEventName) {
        for (const listener of this.listeners.get(type) || []) {
            listener();
        }
    }
}

const makeJob = (overrides: Partial<JobStatusResponse> = {}): JobStatusResponse => ({
    jobId: "public-job-id-123456",
    status: "queued",
    progress: 0,
    currentChapter: null,
    totalChapters: null,
    createdAt: "2026-07-11T12:00:00.000Z",
    completedAt: null,
    expiresAt: null,
    emailStatus: "pending",
    error: null,
    ...overrides
});

afterEach(() => {
    vi.useRealTimers();
});

describe("frontend validation and formatting", () => {
    it("validates audiobook extensions without reading file contents", () => {
        expect(validateAudiobookFile(new File(["x"], "book.mp3")).valid).toBe(true);
        expect(validateAudiobookFile(new File(["x"], "book.m4b")).valid).toBe(true);
        expect(validateAudiobookFile(new File(["x"], "book.wav")).message).toContain("M4B or MP3");
    });

    it("formats file sizes and expiration timestamps safely", () => {
        expect(formatFileSize(0)).toBe("0 B");
        expect(formatFileSize(1024 * 1024)).toBe("1 MB");
        expect(formatExpiration("not-a-date")).toBeNull();
        expect(formatExpiration("2026-07-11T12:00:00.000Z")).toEqual(expect.any(String));
    });

    it("uses shared email validation rules", () => {
        expect(validateEmailAddress(" reader@example.test ")).toBeNull();
        expect(validateEmailAddress("not-an-email")).toBe("Enter a valid email address.");
    });

    it("maps public backend errors to safe guidance", () => {
        expect(
            toFrontendApiError({
                data: {
                    error: {
                        code: "NO_CHAPTERS_FOUND",
                        message: "No embedded chapter metadata was found in this audiobook."
                    }
                }
            }).guidance
        ).toContain("embedded chapter markers");
        expect(toFrontendApiError("<html>bad gateway</html>").code).toBe("UNKNOWN_ERROR");
    });

    it("clamps and preserves progress display", () => {
        expect(clampProgress(120)).toBe(100);
        expect(clampProgress(-5)).toBe(0);
        expect(monotonicProgress(80, 25)).toBe(80);
        expect(displayProcessingProgress("processing", 98, 100)).toBe(99);
        expect(displayProcessingProgress("ready", 98, 100)).toBe(100);
        expect(hasChapterProgress(4, 18)).toBe(true);
        expect(hasChapterProgress(19, 18)).toBe(false);
    });
});

describe("upload composable", () => {
    it("parses successful upload responses and tracks real progress", async () => {
        const xhr = new FakeXhr();
        const {progress, uploadJob} = useJobUpload({createXhr: () => xhr});
        const uploadPromise = uploadJob({
            file: new File(["audio"], "book.mp3"),
            email: "reader@example.test"
        });

        xhr.upload.emitProgress({lengthComputable: true, loaded: 2, total: 4});
        expect(progress.value.percent).toBe(50);
        xhr.status = 202;
        xhr.responseText = JSON.stringify({
            jobId: "public-job-id-123456",
            status: "queued",
            createdAt: "2026-07-11T12:00:00.000Z"
        });
        xhr.emit("load");

        await expect(uploadPromise).resolves.toMatchObject({
            ok: true,
            data: {jobId: "public-job-id-123456"}
        });
        expect(progress.value.percent).toBe(100);
        expect(xhr.sentBody?.get("email")).toBe("reader@example.test");
        expect(xhr.sentBody?.get("file")).toBeInstanceOf(File);
    });

    it("parses backend error bodies without exposing raw payloads", async () => {
        const xhr = new FakeXhr();
        const {uploadJob} = useJobUpload({createXhr: () => xhr});
        const uploadPromise = uploadJob({
            file: new File(["audio"], "book.mp3"),
            email: "reader@example.test"
        });

        xhr.status = 413;
        xhr.responseText = JSON.stringify({
            data: {
                error: {
                    code: "FILE_TOO_LARGE",
                    message: "The uploaded audiobook is larger than the configured limit."
                }
            }
        });
        xhr.emit("load");

        await expect(uploadPromise).resolves.toMatchObject({
            ok: false,
            failure: {
                error: {
                    code: "FILE_TOO_LARGE",
                    statusCode: 413
                }
            }
        });
    });
});

describe("job status composable", () => {
    it("polls through queued and processing states, then stops at ready", async () => {
        vi.useFakeTimers();
        const responses = [
            makeJob({status: "queued"}),
            makeJob({status: "processing", progress: 25}),
            makeJob({
                status: "ready",
                progress: 100,
                completedAt: "2026-07-11T12:30:00.000Z",
                expiresAt: "2026-07-12T00:30:00.000Z",
                emailStatus: "sent"
            })
        ];
        const fetchJobStatus = vi.fn(async () => responses.shift());
        const storage = new MemoryStorage();
        const scope = effectScope();

        const status = scope.run(() => useJobStatus({fetchJobStatus, intervalMs: 10, storage}));

        if (!status) {
            throw new Error("Expected composable result");
        }

        status.startPolling("public-job-id-123456");
        await nextTick();
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(10);

        expect(fetchJobStatus).toHaveBeenCalledTimes(3);
        expect(status.job.value?.status).toBe("ready");
        expect(status.isPolling.value).toBe(false);
        expect(storage.getItem(ACTIVE_JOB_STORAGE_KEY)).toBe("public-job-id-123456");
        scope.stop();
    });

    it("keeps polling when the ZIP is ready but email delivery is pending", async () => {
        vi.useFakeTimers();
        const responses = [
            makeJob({
                status: "ready",
                progress: 100,
                completedAt: "2026-07-11T12:30:00.000Z",
                expiresAt: "2026-07-12T00:30:00.000Z",
                emailStatus: "pending"
            }),
            makeJob({
                status: "ready",
                progress: 100,
                completedAt: "2026-07-11T12:30:00.000Z",
                expiresAt: "2026-07-12T00:30:00.000Z",
                emailStatus: "sent"
            })
        ];
        const fetchJobStatus = vi.fn(async () => responses.shift());
        const scope = effectScope();
        const status = scope.run(() =>
            useJobStatus({
                fetchJobStatus,
                intervalMs: 10,
                storage: new MemoryStorage()
            })
        );

        if (!status) {
            throw new Error("Expected composable result");
        }

        status.startPolling("public-job-id-123456");
        await nextTick();
        expect(status.isPolling.value).toBe(true);
        await vi.advanceTimersByTimeAsync(10);

        expect(fetchJobStatus).toHaveBeenCalledTimes(2);
        expect(status.job.value?.emailStatus).toBe("sent");
        expect(status.isPolling.value).toBe(false);
        scope.stop();
    });

    it("keeps temporary polling failures recoverable", async () => {
        vi.useFakeTimers();
        const fetchJobStatus = vi
            .fn()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce(makeJob({status: "processing", progress: 40}));
        const scope = effectScope();
        const status = scope.run(() =>
            useJobStatus({
                fetchJobStatus,
                intervalMs: 10,
                storage: new MemoryStorage()
            })
        );

        if (!status) {
            throw new Error("Expected composable result");
        }

        status.startPolling("public-job-id-123456");
        await nextTick();
        expect(status.transientError.value).toContain("Retrying");
        await vi.advanceTimersByTimeAsync(10);
        expect(status.job.value?.status).toBe("processing");
        expect(status.transientError.value).toBeNull();
        scope.stop();
    });

    it("recovers an active job from session storage and clears invalid jobs", async () => {
        const storage = new MemoryStorage();
        storage.setItem(ACTIVE_JOB_STORAGE_KEY, "public-job-id-123456");
        const fetchJobStatus = vi.fn(async () => makeJob({status: "expired"}));
        const scope = effectScope();
        const status = scope.run(() => useJobStatus({fetchJobStatus, storage}));

        if (!status) {
            throw new Error("Expected composable result");
        }

        await expect(status.recoverActiveJob()).resolves.toMatchObject({status: "expired"});
        expect(status.job.value?.status).toBe("expired");
        status.clearActiveJob();
        expect(storage.getItem(ACTIVE_JOB_STORAGE_KEY)).toBeNull();
        scope.stop();

        storage.setItem(ACTIVE_JOB_STORAGE_KEY, "missing-job-id-123456");
        const notFound = Object.assign(new Error("not found"), {statusCode: 404});
        const secondScope = effectScope();
        const missingStatus = secondScope.run(() =>
            useJobStatus({
                fetchJobStatus: vi.fn(async () => {
                    throw notFound;
                }),
                storage
            })
        );

        if (!missingStatus) {
            throw new Error("Expected composable result");
        }

        await missingStatus.recoverActiveJob();
        expect(storage.getItem(ACTIVE_JOB_STORAGE_KEY)).toBeNull();
        secondScope.stop();
    });

    it("cancels polling when its Vue scope is disposed", async () => {
        vi.useFakeTimers();
        const fetchJobStatus = vi.fn(async () => makeJob({status: "queued"}));
        const scope = effectScope();
        const status = scope.run(() =>
            useJobStatus({
                fetchJobStatus,
                intervalMs: 10,
                storage: new MemoryStorage()
            })
        );

        if (!status) {
            throw new Error("Expected composable result");
        }

        status.startPolling("public-job-id-123456");
        await nextTick();
        scope.stop();
        await vi.advanceTimersByTimeAsync(50);

        expect(fetchJobStatus).toHaveBeenCalledTimes(1);
        expect(status.isPolling.value).toBe(false);
    });
});
