if (process.env.NUXT_APP_BASE_URL) {
    process.env.CHAPTIFY_APP_BASE_URL = process.env.NUXT_APP_BASE_URL;
    delete process.env.NUXT_APP_BASE_URL;
}

const main = async () => {
    await import(new URL("./server/index.mjs", import.meta.url).href);
};

void main();
