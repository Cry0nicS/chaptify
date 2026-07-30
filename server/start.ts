import {getBackendConfigFromEnv, validateProductionConfig} from "./utils/backend/config";
import {loadDotenv} from "./utils/backend/env";
import {describeTrustProxyMode} from "./utils/backend/rate-limits";

loadDotenv();

const main = async () => {
    const config = getBackendConfigFromEnv();
    validateProductionConfig(config);
    // Stated on every start so the deployed trust policy can be confirmed from the logs instead of
    // being assumed; both wrong answers here are invisible in normal traffic. Logged at warn level
    // because that is the channel this codebase uses for operational advisories.
    console.warn(
        `Trusted-proxy policy (NUXT_TRUST_PROXY): ${describeTrustProxyMode(config.trustProxy)}`
    );
    await import(new URL("./server/index.mjs", import.meta.url).href);
};

void main().catch((error) => {
    console.error("API failed to start", String(error));
    process.exitCode = 1;
});
