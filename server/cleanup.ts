import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {runCleanup} from "./utils/backend/cleanup";
import {ensureStorageRoot, getBackendConfigFromEnv} from "./utils/backend/config";
import {createJobRepository, openDatabase} from "./utils/backend/database";
import {loadDotenv} from "./utils/backend/env";

loadDotenv();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
    const config = getBackendConfigFromEnv();
    await ensureStorageRoot(config.storageRoot);
    const database = openDatabase(config.storageRoot);
    const jobs = createJobRepository(database);
    let shuttingDown = false;
    let running = false;

    const shutdown = () => {
        shuttingDown = true;
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
        await sleep(config.cleanupIntervalSeconds * 1000);
    }

    for (;;) {
        if (!running) {
            break;
        }
        await sleep(100);
    }

    database.close();
};

main().catch((error) => {
    console.error("Cleanup failed", String(error));
    process.exitCode = 1;
});
