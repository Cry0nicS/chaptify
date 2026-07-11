import {execFile} from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface ProcessResult {
    stdout: string;
    stderr: string;
}

export const runProcess = (
    command: string,
    args: string[],
    timeoutMs: number
): Promise<ProcessResult> =>
    new Promise((resolve, reject) => {
        const child = execFile(
            command,
            args,
            {
                timeout: timeoutMs,
                maxBuffer: MAX_OUTPUT_BYTES,
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve({stdout, stderr});
            }
        );

        child.on("error", reject);
    });
