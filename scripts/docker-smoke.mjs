import {Buffer} from "node:buffer";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {inflateRawSync} from "node:zlib";

const apiBaseUrl = "http://127.0.0.1:3000";
const run = (command, args) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    execFileSync(command, args, {stdio: "inherit"});
};

const output = (command, args) =>
    execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "inherit"]}).trim();

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const hashBuffer = (buffer) => createHash("sha256").update(buffer).digest("hex");

const startMailgunMock = async () => {
    const requests = [];
    const server = createServer((request, response) => {
        const chunks = [];

        request.on("data", (chunk) => {
            chunks.push(Buffer.from(chunk));
        });
        request.on("end", () => {
            requests.push({
                method: request.method,
                url: request.url,
                body: Buffer.concat(chunks).toString("utf8")
            });
            response.writeHead(200, {"content-type": "application/json"});
            response.end(JSON.stringify({id: `mock-message-${requests.length}`, message: "queued"}));
        });
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "0.0.0.0", () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Mailgun mock did not expose a TCP port");
    }

    return {
        requests,
        baseUrl: `http://host.docker.internal:${address.port}`,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve();
                });
            })
    };
};

const queryDatabase = (sql, parameters = []) =>
    JSON.parse(
        output("docker", [
            "compose",
            "exec",
            "-T",
            "chaptify",
            "node",
            "-e",
            [
                "const Database=require('better-sqlite3');",
                "const db=new Database('/data/chaptify/database/chaptify.sqlite');",
                "const sql=process.argv[1];",
                "const params=JSON.parse(process.argv[2]);",
                "console.log(JSON.stringify(db.prepare(sql).all(...params)));"
            ].join(""),
            sql,
            JSON.stringify(parameters)
        ]) || "[]"
    );

const executeDatabase = (sql, parameters = []) => {
    output("docker", [
        "compose",
        "exec",
        "-T",
        "chaptify",
        "node",
        "-e",
        [
            "const Database=require('better-sqlite3');",
            "const db=new Database('/data/chaptify/database/chaptify.sqlite');",
            "const sql=process.argv[1];",
            "const params=JSON.parse(process.argv[2]);",
            "db.prepare(sql).run(...params);"
        ].join(""),
        sql,
        JSON.stringify(parameters)
    ]);
};

const assertContainerPathMissing = (path) => {
    run("docker", [
        "compose",
        "exec",
        "-T",
        "chaptify",
        "node",
        "-e",
        "const fs=require('node:fs');process.exit(fs.existsSync(process.argv[1])?1:0);",
        path
    ]);
};

const generateSyntheticAudiobook = async (root, format) => {
    const basePath = join(root, `base.${format}`);
    const metadataPath = join(root, "chapters.ffmetadata");
    const outputPath = join(root, `synthetic.${format}`);

    await writeFile(
        metadataPath,
        [
            ";FFMETADATA1",
            "title=Docker Smoke Book",
            "",
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            "START=0",
            "END=2000",
            "title=Intro One",
            "",
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            "START=2000",
            "END=4000",
            "title=Second Part"
        ].join("\n")
    );
    run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-vn",
        "-sn",
        "-dn",
        "-c:a",
        format === "mp3" ? "libmp3lame" : "aac",
        basePath
    ]);
    run("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        basePath,
        "-i",
        metadataPath,
        "-map_metadata",
        "1",
        "-map_chapters",
        "1",
        "-c",
        "copy",
        outputPath
    ]);

    return outputPath;
};

const extractZip = async (zipPath, outputDirectory) => {
    const buffer = await readFile(zipPath);
    const entries = [];
    let eocdOffset = -1;

    for (let index = buffer.length - 22; index >= 0; index -= 1) {
        if (buffer.readUInt32LE(index) === 0x06054B50) {
            eocdOffset = index;
            break;
        }
    }

    if (eocdOffset < 0) {
        throw new Error("ZIP end-of-central-directory record was not found");
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
    await mkdir(outputDirectory, {recursive: true});

    for (let index = 0; index < entryCount; index += 1) {
        if (buffer.readUInt32LE(centralOffset) !== 0x02014B50) {
            throw new Error("ZIP central directory entry was invalid");
        }

        const compression = buffer.readUInt16LE(centralOffset + 10);
        const compressedSize = buffer.readUInt32LE(centralOffset + 20);
        const nameLength = buffer.readUInt16LE(centralOffset + 28);
        const extraLength = buffer.readUInt16LE(centralOffset + 30);
        const commentLength = buffer.readUInt16LE(centralOffset + 32);
        const localOffset = buffer.readUInt32LE(centralOffset + 42);
        const name = buffer.toString("utf8", centralOffset + 46, centralOffset + 46 + nameLength);

        if (buffer.readUInt32LE(localOffset) !== 0x04034B50) {
            throw new Error("ZIP local file header was invalid");
        }

        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        const contents =
            compression === 0
                ? compressed
                : compression === 8
                  ? inflateRawSync(compressed)
                  : null;

        if (!contents) {
            throw new Error(`Unsupported ZIP compression method ${compression}`);
        }

        const path = join(outputDirectory, basename(name));
        await writeFile(path, contents);
        entries.push({name, path});
        centralOffset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
};

const probeChapter = (path) =>
    JSON.parse(
        output("ffprobe", [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-print_format",
            "json",
            path
        ])
    );

const uploadAudiobook = async (path, format, outputFormat) => {
    const form = new FormData();
    const bytes = await readFile(path);
    form.append("file", new Blob([bytes]), `synthetic.${format}`);
    form.append("email", "docker-smoke@example.test");
    if (outputFormat) {
        form.append("outputFormat", outputFormat);
    }
    const response = await fetch(`${apiBaseUrl}/api/jobs`, {
        method: "POST",
        body: form
    });

    if (response.status !== 202) {
        throw new Error(`Expected upload 202, received ${response.status}: ${await response.text()}`);
    }

    return await response.json();
};

const fetchJobStatus = async (jobId) => {
    const response = await fetch(`${apiBaseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
        throw new Error(`Status endpoint failed with ${response.status}`);
    }

    return await response.json();
};

const waitForReady = async (jobId) => {
    const seen = new Set();

    for (let attempt = 0; attempt < 120; attempt += 1) {
        const status = await fetchJobStatus(jobId);
        seen.add(status.status);
        if (status.status === "ready") {
            return {status, seen};
        }

        if (status.status === "failed" || status.status === "expired") {
            throw new Error(`Job reached terminal non-ready state ${status.status}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error("Job did not become ready");
};

const createGrant = async (jobId, jobAccessToken) => {
    const response = await fetch(`${apiBaseUrl}/api/jobs/${encodeURIComponent(jobId)}/download`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jobAccessToken})
    });

    if (!response.ok) {
        throw new Error(`Grant creation failed with ${response.status}`);
    }

    return await response.json();
};

const waitForExpired = async (jobId, internalId) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(`${apiBaseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
        const status = await response.json();
        const reservations = queryDatabase(
            "SELECT * FROM storage_reservations WHERE owner_id = ? AND released_at IS NULL",
            [internalId]
        );

        if (status.status === "expired" && reservations.length === 0) {
            return status;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Expired cleanup did not release job and reservation");
};

const waitForEmailSent = async (publicJobId) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const rows = queryDatabase(
            "SELECT email_status, email FROM jobs WHERE public_job_id = ?",
            [publicJobId]
        );
        const job = rows[0];

        if (job?.email_status === "sent" && job.email === null) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Worker did not mark pending email sent after restart");
};

const waitForMailgunRequest = async (requests, email) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const request = requests.find((entry) => entry.body.includes(email));

        if (request) {
            return request;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Mailgun mock did not receive the expected completion email");
};

const waitForCleanupHeartbeatChange = async () => {
    const readHeartbeat = () =>
        JSON.parse(
            output("docker", [
                "compose",
                "exec",
                "-T",
                "cleanup",
                "cat",
                "/data/chaptify/cleanup-heartbeat.json"
            ])
        ).lastRunAt;
    const first = readHeartbeat();

    for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const second = readHeartbeat();

        if (new Date(second).getTime() > new Date(first).getTime()) {
            return;
        }
    }

    throw new Error("Cleanup heartbeat did not advance");
};

const createReadyJob = async (root, format, outputFormat) => {
    const sourcePath = await generateSyntheticAudiobook(root, format);

    run("docker", ["compose", "stop", "worker"]);
    const created = await uploadAudiobook(sourcePath, format, outputFormat);
    const queuedStatus = await fetchJobStatus(created.jobId);
    if (queuedStatus.status !== "queued") {
        throw new Error(`Expected ${format} job to be queued before worker restart`);
    }

    run("docker", ["compose", "start", "worker"]);
    const {status, seen} = await waitForReady(created.jobId);

    if (!seen.has("processing")) {
        console.log(`Polling did not catch processing state for ${format}; checking SQLite transition`);
    }

    const jobRows = queryDatabase(
        "SELECT internal_id, source_path, zip_path, processing_started_at FROM jobs WHERE public_job_id = ?",
        [created.jobId]
    );
    const job = jobRows[0];
    if (!job?.internal_id || !job.zip_path) {
        throw new Error("Ready job row was not found in SQLite");
    }
    if (!job.processing_started_at) {
        throw new Error(`Expected ${format} job to pass through processing`);
    }

    return {created, status, job};
};

const runFormatWorkflow = async (root, format, outputFormat) => {
    // When outputFormat differs from the uploaded format, the worker re-encodes rather than
    // stream-copying; this exercises that path against the real Alpine-image ffmpeg.
    const chosenOutput = outputFormat ?? format;
    const label = outputFormat ? `${format}-to-${outputFormat}` : format;
    const expectedExtension = chosenOutput;
    const expectedCodec = chosenOutput === "mp3" ? "mp3" : "aac";
    console.log(`Running Docker end-to-end workflow for ${label}`);
    const {created, status, job} = await createReadyJob(root, format, outputFormat);

    const readyReservations = queryDatabase(
        "SELECT * FROM storage_reservations WHERE owner_id = ? AND released_at IS NULL",
        [job.internal_id]
    );
    if (readyReservations.length !== 1) {
        throw new Error("Ready job storage reservation was not active");
    }

    assertContainerPathMissing(job.source_path);
    assertContainerPathMissing(`/data/chaptify/jobs/${job.internal_id}/chapters`);

    const unusedGrant = await createGrant(created.jobId, created.jobAccessToken);
    const grant = await createGrant(created.jobId, created.jobAccessToken);
    const downloadResponse = await fetch(`${apiBaseUrl}${grant.downloadUrl}`);
    if (!downloadResponse.ok) {
        throw new Error(`ZIP download failed with ${downloadResponse.status}`);
    }

    const zipPath = join(root, `${label}.zip`);
    await writeFile(zipPath, Buffer.from(await downloadResponse.arrayBuffer()));
    if ((await readFile(zipPath)).length === 0) {
        throw new Error("Downloaded ZIP was empty");
    }

    const extractedDirectory = join(root, `${label}-extracted`);
    const entries = await extractZip(zipPath, extractedDirectory);
    const expectedNames = [
        `01 - Intro One.${expectedExtension}`,
        `02 - Second Part.${expectedExtension}`
    ];
    const names = entries.map((entry) => entry.name);
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
        throw new Error(`Unexpected ZIP entries for ${label}: ${names.join(", ")}`);
    }

    for (const [index, entry] of entries.entries()) {
        const probed = probeChapter(entry.path);
        const audioStreams = probed.streams.filter((stream) => stream.codec_type === "audio");
        const nonAudioStreams = probed.streams.filter((stream) => stream.codec_type !== "audio");
        const tags = probed.format.tags || {};
        const duration = Number(probed.format.duration);

        if (audioStreams.length !== 1 || nonAudioStreams.length !== 0) {
            throw new Error(`Unexpected stream layout in ${entry.name}`);
        }

        if (audioStreams[0]?.codec_name !== expectedCodec) {
            throw new Error(
                `Unexpected codec in ${entry.name}: ${audioStreams[0]?.codec_name} (expected ${expectedCodec})`
            );
        }

        if ((probed.chapters || []).length !== 0) {
            throw new Error(`Chapter table leaked into ${entry.name}`);
        }

        if (tags.title !== (index === 0 ? "Intro One" : "Second Part")) {
            throw new Error(`Unexpected title metadata in ${entry.name}`);
        }

        if (tags.track !== `${index + 1}/2`) {
            throw new Error(`Unexpected track metadata in ${entry.name}`);
        }

        if (!Number.isFinite(duration) || duration < 1.5 || duration > 2.5) {
            throw new Error(`Unexpected chapter duration in ${entry.name}`);
        }
    }

    const previousZipPath = job.zip_path;
    executeDatabase("UPDATE jobs SET expires_at = ? WHERE public_job_id = ?", [
        new Date(Date.now() - 1000).toISOString(),
        created.jobId
    ]);
    await waitForExpired(created.jobId, job.internal_id);
    assertContainerPathMissing(previousZipPath);

    const expiredGrantResponse = await fetch(`${apiBaseUrl}${unusedGrant.downloadUrl}`);
    if (expiredGrantResponse.status !== 404) {
        throw new Error(`Expected expired browser grant to return 404, got ${expiredGrantResponse.status}`);
    }

    if (status.status !== "ready") {
        throw new Error("Ready status was not preserved before expiration");
    }
};

const runWorkerRestartEmailWorkflow = async (root, mailgunMock) => {
    console.log("Running Docker worker restart email recovery workflow");
    const restartEmail = "restart-smoke@example.test";
    const {created, job} = await createReadyJob(root, "mp3");

    run("docker", ["compose", "stop", "worker"]);
    executeDatabase(
        [
            "UPDATE jobs",
            "SET email = ?,",
            "email_status = 'pending',",
            "email_attempts = 0,",
            "email_next_attempt_at = ?,",
            "email_sent_at = NULL,",
            "email_last_error = NULL,",
            "email_message_id = NULL",
            "WHERE public_job_id = ? AND status = 'ready'"
        ].join(" "),
        [restartEmail, new Date().toISOString(), created.jobId]
    );

    const pendingRows = queryDatabase(
        "SELECT email_status, email FROM jobs WHERE public_job_id = ?",
        [created.jobId]
    );
    if (pendingRows[0]?.email_status !== "pending" || pendingRows[0]?.email !== restartEmail) {
        throw new Error("Failed to prepare ready job with pending email");
    }

    run("docker", ["compose", "start", "worker"]);
    const mailgunRequest = await waitForMailgunRequest(mailgunMock.requests, restartEmail);
    await waitForEmailSent(created.jobId);

    const match = mailgunRequest.body.match(/https?:\/\/localhost:3000\/api\/download\/[^\s"<]+/);
    if (!match) {
        throw new Error("Mailgun mock email did not include a signed download URL");
    }

    const signedDownloadUrl = match[0].replace("http://localhost:3000", apiBaseUrl);
    const emailDownloadResponse = await fetch(signedDownloadUrl);
    if (!emailDownloadResponse.ok) {
        throw new Error(`Signed email download failed with ${emailDownloadResponse.status}`);
    }

    const grant = await createGrant(created.jobId, created.jobAccessToken);
    const grantDownloadResponse = await fetch(`${apiBaseUrl}${grant.downloadUrl}`);
    if (!grantDownloadResponse.ok) {
        throw new Error(`Browser grant download failed with ${grantDownloadResponse.status}`);
    }

    const emailZip = Buffer.from(await emailDownloadResponse.arrayBuffer());
    const grantZip = Buffer.from(await grantDownloadResponse.arrayBuffer());
    if (hashBuffer(emailZip) !== hashBuffer(grantZip)) {
        throw new Error("Signed email URL did not resolve to the same ready ZIP");
    }

    const readyRows = queryDatabase(
        "SELECT zip_path FROM jobs WHERE public_job_id = ? AND email_status = 'sent' AND email IS NULL",
        [created.jobId]
    );
    if (readyRows[0]?.zip_path !== job.zip_path) {
        throw new Error("Email recovery changed the ready ZIP path");
    }
};

const mailgunMock = await startMailgunMock();
process.env.NUXT_MAILGUN_BASE_URL = mailgunMock.baseUrl;
process.env.NUXT_MAILGUN_DOMAIN = "mailgun-smoke.test";
process.env.NUXT_MAILGUN_KEY = "mailgun-smoke-key";
process.env.NUXT_MAILGUN_SENDER = "sender@mailgun-smoke.test";
process.env.NUXT_MAILGUN_RECIPIENT = "";
process.env.NUXT_MAILGUN_BCC = "";
process.env.NUXT_CLEANUP_INTERVAL_SECONDS = "2";

try {
    run("docker", ["compose", "up", "-d", "--build"]);

    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            const body = output("docker", [
                "compose",
                "exec",
                "-T",
                "chaptify",
                "node",
                "-e",
                "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1); console.log(await r.text())})"
            ]);

            if (body.includes("ok")) {
                healthy = true;
                break;
            }
        } catch {
            sleep(1000);
        }
    }

    if (!healthy) {
        throw new Error("API health check did not become healthy");
    }

    run("docker", ["compose", "exec", "-T", "chaptify", "ffmpeg", "-version"]);
    run("docker", ["compose", "exec", "-T", "chaptify", "ffprobe", "-version"]);
    run("docker", ["compose", "exec", "-T", "worker", "test", "-d", "/data/chaptify"]);
    run("docker", [
        "compose",
        "exec",
        "-T",
        "chaptify",
        "test",
        "-f",
        "/data/chaptify/database/chaptify.sqlite"
    ]);
    run("docker", [
        "compose",
        "exec",
        "-T",
        "cleanup",
        "test",
        "-f",
        "/data/chaptify/cleanup-heartbeat.json"
    ]);
    await waitForCleanupHeartbeatChange();

    const root = await mkdtemp(join(tmpdir(), "chaptify-docker-smoke-"));
    try {
        // Same-format runs stream-copy; the cross-format runs re-encode (mp3<->aac) so the
        // Alpine-image encoders (libmp3lame/aac) are exercised end-to-end.
        for (const [format, outputFormat] of [
            ["mp3", undefined],
            ["m4b", undefined],
            ["mp3", "m4b"],
            ["m4b", "mp3"]
        ]) {
            await runFormatWorkflow(root, format, outputFormat);
        }
        await runWorkerRestartEmailWorkflow(root, mailgunMock);
    } finally {
        await rm(root, {recursive: true, force: true});
    }

    const ps = output("docker", ["compose", "ps", "--status", "running", "--services"]);
    if (!ps.split(/\r?\n/).includes("worker")) {
        throw new Error("Worker service is not running");
    }
    if (!ps.split(/\r?\n/).includes("cleanup")) {
        throw new Error("Cleanup service is not running");
    }

    console.log("Docker smoke checks passed.");
} finally {
    await mailgunMock.close();
}
