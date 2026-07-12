import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

type WritableEnv = NodeJS.ProcessEnv;

const ENV_NAME_PATTERN = /^[a-z_]\w*$/i;

const stripInlineComment = (value: string): string => {
    const commentIndex = value.search(/\s#/);

    if (commentIndex === -1) {
        return value;
    }

    return value.slice(0, commentIndex);
};

const parseEnvValue = (rawValue: string): string => {
    const value = rawValue.trim();
    const quote = value.at(0);

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        const quotedValue = value.slice(1, -1);

        if (quote === '"') {
            return quotedValue
                .replaceAll("\\n", "\n")
                .replaceAll("\\r", "\r")
                .replaceAll("\\t", "\t")
                .replaceAll('\\"', '"')
                .replaceAll("\\\\", "\\");
        }

        return quotedValue;
    }

    return stripInlineComment(value).trim();
};

export const parseDotenv = (contents: string): Record<string, string> => {
    const parsed: Record<string, string> = {};

    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) {
            continue;
        }

        const normalizedLine = line.startsWith("export ")
            ? line.slice("export ".length).trim()
            : line;
        const separatorIndex = normalizedLine.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const name = normalizedLine.slice(0, separatorIndex).trim();

        if (!ENV_NAME_PATTERN.test(name)) {
            continue;
        }

        parsed[name] = parseEnvValue(normalizedLine.slice(separatorIndex + 1));
    }

    return parsed;
};

export const normalizeChaptifyEnv = (env: WritableEnv = process.env) => {
    const appBaseUrl = env.NUXT_APP_BASE_URL;

    if (appBaseUrl && !env.CHAPTIFY_APP_BASE_URL) {
        env.CHAPTIFY_APP_BASE_URL = appBaseUrl;
    }

    if (Object.hasOwn(env, "NUXT_APP_BASE_URL")) {
        delete env.NUXT_APP_BASE_URL;
    }
};

export const loadDotenv = (cwd = process.cwd(), env: WritableEnv = process.env) => {
    const envPath = resolve(cwd, ".env");

    if (!existsSync(envPath)) {
        normalizeChaptifyEnv(env);
        return;
    }

    const parsed = parseDotenv(readFileSync(envPath, "utf8"));

    for (const [name, value] of Object.entries(parsed)) {
        if (!Object.hasOwn(env, name)) {
            env[name] = value;
        }
    }

    normalizeChaptifyEnv(env);
};
