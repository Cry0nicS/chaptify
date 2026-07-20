import type {OutputFormat, UploadJobResponse} from "#shared/utils/types";
import type {FrontendApiError} from "../utils/api-errors";
import {ref} from "vue";
import {uploadJobResponseSchema} from "#shared/utils/schemas";
import {toFrontendApiError} from "../utils/api-errors";
import {formatFileSize} from "../utils/format-file-size";

export interface UploadProgress {
    percent: number;
    loaded: number;
    total: number | null;
    label: string;
}

export interface UploadFailure {
    error: FrontendApiError;
}

export type UploadResult =
    | {
          ok: true;
          data: UploadJobResponse;
      }
    | {
          ok: false;
          failure: UploadFailure;
      };

interface UploadOptions {
    file: File;
    email: string;
    outputFormat: OutputFormat;
    // Split-only field; omit for conversions (the convert endpoint rejects unknown fields).
    splitWithoutChapters?: boolean;
    timeoutMs?: number;
}

interface UploadProgressEvent {
    lengthComputable: boolean;
    loaded: number;
    total: number;
}

interface MinimalXhrUpload {
    addEventListener: (type: "progress", listener: (event: UploadProgressEvent) => void) => void;
    removeEventListener: (type: "progress", listener: (event: UploadProgressEvent) => void) => void;
}

interface MinimalXhr {
    status: number;
    responseText: string;
    timeout: number;
    upload: MinimalXhrUpload;
    open: (method: string, url: string) => void;
    send: (body: FormData) => void;
    abort: () => void;
    addEventListener: (type: "load" | "error" | "abort" | "timeout", listener: () => void) => void;
    removeEventListener: (
        type: "load" | "error" | "abort" | "timeout",
        listener: () => void
    ) => void;
}

interface UseJobUploadOptions {
    createXhr?: () => MinimalXhr;
    /** Upload target. Defaults to the split endpoint; the converter passes "/api/convert". */
    endpoint?: string;
}

const defaultProgress = (): UploadProgress => ({
    percent: 0,
    loaded: 0,
    total: null,
    label: "Waiting to upload"
});

const parseJson = (responseText: string): unknown => {
    if (!responseText.trim()) {
        return null;
    }

    try {
        return JSON.parse(responseText) as unknown;
    } catch {
        return null;
    }
};

interface UploadListeners {
    progress: (event: UploadProgressEvent) => void;
    load: () => void;
    error: () => void;
    abort: () => void;
    timeout: () => void;
}

/**
 * Uploads one audiobook with real browser upload progress.
 *
 * Nuxt `$fetch` does not expose upload progress events, so this composable owns an XHR instance
 * and removes every listener when the request settles. It rejects concurrent uploads to avoid
 * mixing progress and abort state between two multipart requests.
 */
export const useJobUpload = (options: UseJobUploadOptions = {}) => {
    const progress = ref<UploadProgress>(defaultProgress());
    const isUploading = ref(false);
    const activeXhr = ref<MinimalXhr | null>(null);
    const endpoint = options.endpoint || "/api/jobs";

    const createXhr =
        options.createXhr ||
        (() => {
            if (!import.meta.client) {
                throw new Error("Uploads can only run in a browser.");
            }

            return new XMLHttpRequest() as MinimalXhr;
        });

    const cleanup = (xhr: MinimalXhr, listeners: UploadListeners) => {
        xhr.upload.removeEventListener("progress", listeners.progress);
        xhr.removeEventListener("load", listeners.load);
        xhr.removeEventListener("error", listeners.error);
        xhr.removeEventListener("abort", listeners.abort);
        xhr.removeEventListener("timeout", listeners.timeout);
    };

    const uploadJob = async ({
        file,
        email,
        outputFormat,
        splitWithoutChapters,
        timeoutMs = 0
    }: UploadOptions): Promise<UploadResult> => {
        if (isUploading.value) {
            return {
                ok: false,
                failure: {
                    error: {
                        code: "UNKNOWN_ERROR",
                        message: "An upload is already in progress.",
                        guidance: "Wait for the current upload to finish before trying again."
                    }
                }
            };
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("email", email.trim());
        formData.append("outputFormat", outputFormat);
        if (splitWithoutChapters !== undefined) {
            formData.append("splitWithoutChapters", splitWithoutChapters ? "true" : "false");
        }

        isUploading.value = true;
        progress.value = defaultProgress();

        return await new Promise<UploadResult>((resolve) => {
            const xhr = createXhr();
            activeXhr.value = xhr;
            xhr.timeout = timeoutMs;
            let listeners: UploadListeners;

            const finish = (result: UploadResult) => {
                cleanup(xhr, listeners);
                activeXhr.value = null;
                isUploading.value = false;
                resolve(result);
            };

            listeners = {
                progress(event: UploadProgressEvent) {
                    const total = event.lengthComputable ? event.total : null;
                    const percent =
                        total && total > 0
                            ? Math.min(99, Math.round((event.loaded / total) * 100))
                            : 0;
                    const totalLabel = total ? ` of ${formatFileSize(total)}` : "";

                    progress.value = {
                        percent,
                        loaded: event.loaded,
                        total,
                        label: `${formatFileSize(event.loaded)}${totalLabel} uploaded`
                    };
                },
                load() {
                    const body = parseJson(xhr.responseText);

                    if (xhr.status === 202) {
                        const parsed = uploadJobResponseSchema.safeParse(body);

                        if (parsed.success) {
                            progress.value = {
                                percent: 100,
                                loaded: file.size,
                                total: file.size,
                                label: "Upload complete"
                            };
                            finish({ok: true, data: parsed.data});
                            return;
                        }
                    }

                    finish({
                        ok: false,
                        failure: {
                            error: {
                                ...toFrontendApiError(body, "The upload could not be accepted."),
                                statusCode: xhr.status || undefined
                            }
                        }
                    });
                },
                error() {
                    finish({
                        ok: false,
                        failure: {
                            error: {
                                code: "NETWORK_ERROR",
                                message: "The upload was interrupted before it reached the server.",
                                guidance: "Check your connection and try the upload again."
                            }
                        }
                    });
                },
                abort() {
                    finish({
                        ok: false,
                        failure: {
                            error: {
                                code: "NETWORK_ERROR",
                                message: "The upload was canceled.",
                                guidance:
                                    "Select an audiobook and start the upload again when ready."
                            }
                        }
                    });
                },
                timeout() {
                    finish({
                        ok: false,
                        failure: {
                            error: {
                                code: "NETWORK_ERROR",
                                message: "The upload timed out.",
                                guidance: "Check your connection and try again."
                            }
                        }
                    });
                }
            };

            xhr.upload.addEventListener("progress", listeners.progress);
            xhr.addEventListener("load", listeners.load);
            xhr.addEventListener("error", listeners.error);
            xhr.addEventListener("abort", listeners.abort);
            xhr.addEventListener("timeout", listeners.timeout);
            xhr.open("POST", endpoint);
            xhr.send(formData);
        });
    };

    const abortUpload = () => {
        activeXhr.value?.abort();
    };

    return {
        abortUpload,
        isUploading,
        progress,
        uploadJob
    };
};
