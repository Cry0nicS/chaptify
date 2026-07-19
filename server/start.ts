import {getBackendConfigFromEnv, validateProductionConfig} from "./utils/backend/config";
import {loadDotenv} from "./utils/backend/env";

loadDotenv();

const main = async () => {
    validateProductionConfig(getBackendConfigFromEnv());
    await import(new URL("./server/index.mjs", import.meta.url).href);
};

void main().catch((error) => {
    console.error("API failed to start", String(error));
    process.exitCode = 1;
});
