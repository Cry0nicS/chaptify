import {loadDotenv} from "./utils/backend/env";

loadDotenv();

const main = async () => {
    await import(new URL("./server/index.mjs", import.meta.url).href);
};

void main();
