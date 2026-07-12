import {ensureStorageRoot, getBackendConfigFromEnv} from "./utils/backend/config";
import {createJobRepository, openDatabase} from "./utils/backend/database";
import {loadDotenv} from "./utils/backend/env";
import {runWorkerLoop} from "./utils/backend/worker";

loadDotenv();

const main = async () => {
    const config = getBackendConfigFromEnv();
    await ensureStorageRoot(config.storageRoot);
    const database = openDatabase(config.storageRoot);
    const jobs = createJobRepository(database);

    await runWorkerLoop(config, jobs);
};

main().catch((error) => {
    console.error("Worker stopped unexpectedly", String(error));
    process.exitCode = 1;
});
