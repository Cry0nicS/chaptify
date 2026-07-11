import {spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";

const readEnvValue = (name) => {
    if (!existsSync(".env")) {
        return "";
    }

    const line = readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .find((entry) => entry.trim().startsWith(`${name}=`));

    if (!line) {
        return "";
    }

    return line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
};

const env = {...process.env};
const configuredBaseUrl = env.NUXT_APP_BASE_URL || readEnvValue("NUXT_APP_BASE_URL");

if (configuredBaseUrl) {
    env.CHAPTIFY_APP_BASE_URL = configuredBaseUrl;
    env.NUXT_APP_BASE_URL = "";
}

const child = spawn("npx", ["nuxi", "dev"], {
    env,
    shell: process.platform === "win32",
    stdio: "inherit"
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exitCode = code || 0;
});
