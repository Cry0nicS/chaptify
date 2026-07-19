import {Buffer} from "node:buffer";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createChapterZip} from "../../server/utils/backend/archive";

import {listZipEntries, makeStorageRoot, registerBackendTestHooks} from "./helpers";

vi.mock("mailgun.js", async () => (await import("./mailgun-mock")).mailgunModuleMock());

registerBackendTestHooks();

describe("chapter archive ordering", () => {
    it("preserves chapter order regardless of per-file size", async () => {
        const root = await makeStorageRoot();
        const outputDirectory = join(root, "jobs", "zip-order", "output");
        const chaptersDirectory = join(root, "jobs", "zip-order", "chapters");
        await mkdir(outputDirectory, {recursive: true});
        await mkdir(chaptersDirectory, {recursive: true});

        // A large first chapter followed by tiny later chapters is the layout that made archiver's
        // concurrent stat float the smaller files ahead; the ordered names must survive it.
        const chapterPaths: string[] = [];
        for (const [index, size] of [900_000, 20_000, 20_000].entries()) {
            const name = `${String(index + 1).padStart(2, "0")} - Chapter ${index + 1}.m4b`;
            const chapterPath = join(chaptersDirectory, name);
            await writeFile(chapterPath, Buffer.alloc(size, index + 1));
            chapterPaths.push(chapterPath);
        }

        const expected = ["01 - Chapter 1.m4b", "02 - Chapter 2.m4b", "03 - Chapter 3.m4b"];

        // Rebuild several times so a nondeterministic reordering cannot pass by luck.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const zipPath = await createChapterZip(
                root,
                outputDirectory,
                `chapters-${attempt}.zip`,
                chapterPaths
            );
            expect(await listZipEntries(zipPath)).toEqual(expected);
        }
    });
});
