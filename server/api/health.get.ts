import {access, appendFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {createBackendContext} from "../utils/backend/context";
import {ensurePathInside} from "../utils/backend/paths";

export default defineEventHandler(async () => {
    try {
        const {config, database} = await createBackendContext();
        database.prepare("SELECT 1").get();
        await access(config.storageRoot);
        const probePath = ensurePathInside(
            config.storageRoot,
            join(config.storageRoot, ".healthcheck")
        );
        await appendFile(probePath, "");
        await rm(probePath, {force: true});

        return {status: "ok"};
    } catch {
        throw createError({statusCode: 503, statusMessage: "Service unavailable"});
    }
});
