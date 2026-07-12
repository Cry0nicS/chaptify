import {runCleanup} from "./utils/backend/cleanup";
import {ensureStorageRoot, getBackendConfigFromEnv} from "./utils/backend/config";
import {createJobRepository, openDatabase} from "./utils/backend/database";
import {loadDotenv} from "./utils/backend/env";

loadDotenv();

const main = async () => {
    const config = getBackendConfigFromEnv();
    await ensureStorageRoot(config.storageRoot);
    const database = openDatabase(config.storageRoot);
    const jobs = createJobRepository(database);

    await runCleanup(config.storageRoot, jobs);
};

main().catch((error) => {
    console.error("Cleanup failed", String(error));
    process.exitCode = 1;
});
