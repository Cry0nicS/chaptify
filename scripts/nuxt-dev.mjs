import {spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";

const parseEnvValue = (rawValue) => {
    const value = rawValue.trim();
    const quote = value.at(0);

    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
        return value.slice(1, -1);
    }

    const commentIndex = value.search(/\s#/);

    if (commentIndex === -1) {
        return value;
    }

    return value.slice(0, commentIndex).trim();
};

const readDotenv = () => {
    if (!existsSync(".env")) {
        return {};
    }

    const parsed = {};

    for (const rawLine of readFileSync(".env", "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) {
            continue;
        }

        const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
        const separatorIndex = normalizedLine.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const name = normalizedLine.slice(0, separatorIndex).trim();

        if (!/^[a-z_]\w*$/i.test(name)) {
            continue;
        }

        parsed[name] = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
    }

    return parsed;
};

const env = {...process.env};
const dotenv = readDotenv();

for (const [name, value] of Object.entries(dotenv)) {
    if (!Object.hasOwn(env, name)) {
        env[name] = value;
    }
}

if (env.NUXT_APP_BASE_URL && !env.CHAPTIFY_APP_BASE_URL) {
    env.CHAPTIFY_APP_BASE_URL = env.NUXT_APP_BASE_URL;
}

if (Object.hasOwn(env, "NUXT_APP_BASE_URL")) {
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
