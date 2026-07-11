import {ensureStorageRoot, getBackendConfig} from "./config";
import {createJobRepository, openDatabase} from "./database";

export const createBackendContext = async () => {
    const config = getBackendConfig();
    await ensureStorageRoot(config.storageRoot);
    const database = openDatabase(config.storageRoot);
    const jobs = createJobRepository(database);

    return {
        config,
        database,
        jobs
    };
};
