import {execFile} from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Grace period between the initial SIGTERM (from an abort or the execFile timeout) and a forced
 * SIGKILL. A well-behaved FFmpeg exits on SIGTERM well within this window; the escalation only
 * matters for a process that ignores it, so it does not linger and hold a worker slot or file lock.
 */
const FORCE_KILL_GRACE_MS = 5_000;

export interface ProcessResult {
    stdout: string;
    stderr: string;
}

export const runProcess = (
    command: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal
): Promise<ProcessResult> =>
    new Promise((resolve, reject) => {
        let settled = false;
        let abortForceKillTimer: ReturnType<typeof setTimeout> | null = null;
        let deadlineForceKillTimer: ReturnType<typeof setTimeout> | null = null;

        const child = execFile(
            command,
            args,
            {
                timeout: timeoutMs,
                maxBuffer: MAX_OUTPUT_BYTES,
                signal,
                killSignal: "SIGTERM",
                windowsHide: true
            },
            (error, stdout, stderr) => {
                // execFile resolves this callback as soon as the signal aborts or the timeout
                // elapses, without waiting for the child to actually exit. The promise settles here,
                // but the SIGKILL escalation below stays armed until the child is truly gone.
                if (settled) {
                    return;
                }

                settled = true;

                if (error) {
                    reject(error);
                    return;
                }

                resolve({stdout, stderr});
            }
        );

        const forceKill = () => child.kill("SIGKILL");

        const scheduleAbortForceKill = () => {
            if (!abortForceKillTimer) {
                abortForceKillTimer = setTimeout(forceKill, FORCE_KILL_GRACE_MS);
            }
        };

        // The initial SIGTERM is sent by execFile on abort or timeout. If the child ignores it and
        // is still running after the grace window, escalate to SIGKILL so it cannot linger.
        if (signal?.aborted) {
            scheduleAbortForceKill();
        } else {
            signal?.addEventListener("abort", scheduleAbortForceKill, {once: true});
        }

        if (timeoutMs > 0) {
            deadlineForceKillTimer = setTimeout(forceKill, timeoutMs + FORCE_KILL_GRACE_MS);
        }

        // Escalation is bound to the child's lifetime, not the promise: clear the kill timers only
        // once the child has actually exited (which also fires after a successful SIGKILL).
        child.once("close", () => {
            if (abortForceKillTimer) {
                clearTimeout(abortForceKillTimer);
            }

            if (deadlineForceKillTimer) {
                clearTimeout(deadlineForceKillTimer);
            }

            signal?.removeEventListener("abort", scheduleAbortForceKill);
        });

        child.on("error", (error) => {
            if (settled) {
                return;
            }

            settled = true;
            reject(error);
        });
    });
