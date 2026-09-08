import { hrtime } from "node:process";
import { execFileSync, spawn } from "node:child_process";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import net from "node:net";

const TFSL_DIR = resolve(import.meta.dirname, "..");
const FIXTURE_DIR = join(TFSL_DIR, "fixture");
const CLI_PATH = join(TFSL_DIR, "bin/tfsl.js");
const EXAMPLE_CYAN = join(TFSL_DIR, "examples/stellar-cyan.theme.json");
const ASTRO_BIN = join(FIXTURE_DIR, "node_modules/astro/bin/astro.mjs");

/**
 * @param {bigint} startNanos
 * @returns {number}
 */
function elapsedMs(startNanos) {
  const diff = hrtime.bigint() - startNanos;
  return Number(diff) / 1_000_000;
}

/**
 * @param {number[]} samples
 */
function stats(samples) {
  const n = samples.length;
  const mean = samples.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) / n;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const variance = samples.reduce((/** @type {number} */ acc, /** @type {number} */ x) => acc + Math.pow(x - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);
  return { n, mean: Number(mean.toFixed(2)), min: Number(min.toFixed(2)), max: Number(max.toFixed(2)), stddev: Number(stddev.toFixed(2)), raw: samples.map((/** @type {number} */ s) => Number(s.toFixed(2))) };
}

async function measureColdCli() {
  console.log("Measuring cold CLI compile (5 samples)...");
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const tmp = await mkdtemp(join(tmpdir(), "tfsl-bench-cold-"));
    const start = hrtime.bigint();
    execFileSync(process.execPath, [CLI_PATH, "compile", EXAMPLE_CYAN, "--out", tmp], { cwd: TFSL_DIR, stdio: "ignore" });
    samples.push(elapsedMs(start));
    await rm(tmp, { recursive: true, force: true });
  }
  return stats(samples);
}

async function measureInProcess() {
  console.log("Measuring in-process compilation (20 iterations)...");
  const { compileTheme } = await import(join(TFSL_DIR, "dist/index.js"));
  const spec = JSON.parse(await readFile(EXAMPLE_CYAN, "utf8"));
  // Warmup
  for (let i = 0; i < 5; i++) {
    compileTheme(spec);
  }
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const start = hrtime.bigint();
    compileTheme(spec);
    samples.push(elapsedMs(start));
  }
  return stats(samples);
}

async function measureAstroBuild() {
  console.log("Measuring Astro fixture build (3 samples)...");
  // Pre-compile cyan theme to ensure reproducible build from a clean checkout
  execFileSync(process.execPath, [CLI_PATH, "compile", EXAMPLE_CYAN, "--out", join(FIXTURE_DIR, "src/styles/cyan"), "--overwrite"], {
    cwd: TFSL_DIR,
    stdio: "ignore",
  });
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const start = hrtime.bigint();
    execFileSync(process.execPath, [ASTRO_BIN, "build"], {
      cwd: FIXTURE_DIR,
      stdio: "ignore",
      env: {
        ...process.env,
        TFSL_THEME_CSS: "./src/styles/cyan/theme.css",
        ASTRO_OUT_DIR: "./dist/cyan",
      },
    });
    samples.push(elapsedMs(start));
  }
  return stats(samples);
}

/**
 * Find an available ephemeral port
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : null;
      srv.close((err) => {
        if (err || !port) reject(err || new Error("Failed to allocate ephemeral port"));
        else resolvePromise(port);
      });
    });
  });
}

/**
 * Assert no active listener is already attached to the given port
 * @param {number} port
 * @returns {Promise<void>}
 */
function assertNoListener(port) {
  return new Promise((resolvePromise, reject) => {
    const client = net.connect({ host: "127.0.0.1", port }, () => {
      client.destroy();
      reject(new Error(`Port ${port} already has an active listener`));
    });
    client.on("error", () => {
      resolvePromise();
    });
  });
}

/**
 * Poll until the port is confirmed released with no active listeners
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitForPortRelease(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await assertNoListener(port);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`Port ${port} was not released within ${timeoutMs}ms after process shutdown`);
}

/**
 * Poll until HTTP 200 is returned, starting timing from before process spawn
 * @param {number} port
 * @param {bigint} startNanos
 * @param {number} [timeoutMs]
 * @returns {Promise<number>}
 */
function waitForHttp(port, startNanos, timeoutMs = 15000) {
  return new Promise((resolvePromise, reject) => {
    const inFlight = new Set();
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearInterval(interval);
      for (const req of inFlight) {
        try {
          req.destroy();
        } catch {}
      }
      inFlight.clear();
    };

    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for HTTP 200 on port ${port}`));
    }, timeoutMs);

    const interval = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          cleanup();
          resolvePromise(elapsedMs(startNanos));
        }
      });
      inFlight.add(req);
      req.on("close", () => inFlight.delete(req));
      req.on("error", () => {
        inFlight.delete(req);
        // Retry on connection refused until timeout timer expires
      });
    }, 25);
  });
}

async function measurePreviewStartup() {
  console.log("Measuring Astro preview startup with fresh ephemeral ports (3 samples)...");
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const port = await getFreePort();
    await assertNoListener(port);

    const start = hrtime.bigint();
    const proc = spawn(process.execPath, [ASTRO_BIN, "preview", "--host", "127.0.0.1", "--port", String(port), "--ignore-lock"], {
      cwd: FIXTURE_DIR,
      stdio: "ignore",
      env: {
        ...process.env,
        ASTRO_OUT_DIR: "./dist/cyan",
        ASTRO_PREVIEW_BACKGROUND: "false",
      },
    });

    try {
      const latency = await waitForHttp(port, start, 15000);
      samples.push(latency);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolvePromise) => {
        proc.on("exit", resolvePromise);
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
          resolvePromise();
        }, 1500);
      });
      // Invert listener check to verify port is released after shutdown
      await waitForPortRelease(port);
    }
  }
  return stats(samples);
}

async function run() {
  const coldCli = await measureColdCli();
  const inProcess = await measureInProcess();
  const astroBuild = await measureAstroBuild();
  const preview = await measurePreviewStartup();

  const report = {
    timestamp: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    measurements: {
      coldCliCompileMs: coldCli,
      inProcessCompileMs: inProcess,
      astroFixtureBuildMs: astroBuild,
      previewStartupMs: preview,
    },
  };

  console.log("\n=== TFSL Viability Benchmark Report ===");
  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
