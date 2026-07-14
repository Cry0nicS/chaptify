import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {runCleanup} from "./utils/backend/cleanup";
import {ensureStorageRoot, getBackendConfigFromEnv} from "./utils/backend/config";
import {createJobRepository, openDatabase} from "./utils/backend/database";
import {loadDotenv} from "./utils/backend/env";

loadDotenv();

const createInterruptibleSleep = () => {
    let wake: (() => void) | null = null;

    return {
        sleep(ms: number) {
            return new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    wake = null;
                    resolve();
                }, ms);

                wake = () => {
                    clearTimeout(timer);
                    wake = null;
                    resolve();
                };
            });
        },
        wake() {
            wake?.();
        }
    };
};

const main = async () => {
    const config = getBackendConfigFromEnv();
    await ensureStorageRoot(config.storageRoot);
    const database = openDatabase(config.storageRoot);
    const jobs = createJobRepository(database);
    let shuttingDown = false;
    let running = false;
    const sleeper = createInterruptibleSleep();

    const shutdown = () => {
        shuttingDown = true;
        sleeper.wake();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    const runOnce = async () => {
        if (running) {
            return;
        }

        running = true;
        try {
            await runCleanup(config, jobs);
            await writeFile(
                join(config.storageRoot, "cleanup-heartbeat.json"),
                `${JSON.stringify({lastRunAt: new Date().toISOString()})}\n`,
                {mode: 0o600}
            );
        } catch (error) {
            console.error("Cleanup iteration failed", String(error));
        } finally {
            running = false;
        }
    };

    for (;;) {
        if (shuttingDown) {
            break;
        }
        await runOnce();
        if (!shuttingDown) {
            await sleeper.sleep(config.cleanupIntervalSeconds * 1000);
        }
    }

    for (;;) {
        if (!running) {
            break;
        }
        await sleeper.sleep(100);
    }

    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    database.close();
};

main().catch((error) => {
    console.error("Cleanup failed", String(error));
    process.exitCode = 1;
});
