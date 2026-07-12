import {execFileSync} from "node:child_process";

const run = (command, args) => {
    console.log(`$ ${command} ${args.join(" ")}`);
    execFileSync(command, args, {stdio: "inherit"});
};

const output = (command, args) =>
    execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "inherit"]}).trim();

run("docker", ["compose", "up", "-d", "--build"]);

let healthy = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
        const body = output("docker", [
            "compose",
            "exec",
            "-T",
            "public-notice",
            "node",
            "-e",
            "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1); console.log(await r.text())})"
        ]);

        if (body.includes("ok")) {
            healthy = true;
            break;
        }
    } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
}

if (!healthy) {
    throw new Error("API health check did not become healthy");
}

run("docker", ["compose", "exec", "-T", "public-notice", "ffmpeg", "-version"]);
run("docker", ["compose", "exec", "-T", "public-notice", "ffprobe", "-version"]);
run("docker", ["compose", "exec", "-T", "worker", "test", "-d", "/data/chaptify"]);
run("docker", ["compose", "exec", "-T", "public-notice", "test", "-f", "/data/chaptify/database/chaptify.sqlite"]);
run("docker", ["compose", "run", "--rm", "cleanup"]);

const ps = output("docker", ["compose", "ps", "--status", "running", "--services"]);
if (!ps.split(/\r?\n/).includes("worker")) {
    throw new Error("Worker service is not running");
}

console.log("Docker smoke checks passed.");
