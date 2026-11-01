import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../.venv/Scripts/python.exe"
      : "../.venv/bin/python",
    import.meta.url,
  ),
);
let api;
let web;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await web?.close();
  if (api && api.exitCode === null && api.signalCode === null) {
    const exited = new Promise((resolve) => api.once("exit", resolve));
    api.kill("SIGTERM");
    const exitedCleanly = await Promise.race([
      exited.then(() => true),
      delay(3000).then(() => false),
    ]);
    if (!exitedCleanly) api.kill("SIGKILL");
  }
  process.exit(code);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function apiReady() {
  try {
    const response = await fetch("http://127.0.0.1:8011/health", {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok)
      throw new Error("Port 8011 is occupied by another service.");
    const health = await response.json();
    if (
      health.status !== "ok" ||
      !health.rule_pack?.startsWith("cs-general-")
    ) {
      throw new Error("Port 8011 is occupied by another service.");
    }
    return true;
  } catch (error) {
    if (error.message?.includes("occupied")) throw error;
    return false;
  }
}

try {
  if (!(await apiReady())) {
    if (!existsSync(python)) {
      throw new Error(
        "Python environment missing. Run: python3.13 -m venv .venv\nThen: .venv/bin/pip install -r server/requirements.lock",
      );
    }
    console.log("Starting the planning API on http://127.0.0.1:8011 …");
    api = spawn(
      python,
      [
        "-m",
        "uvicorn",
        "server.app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8011",
        "--reload",
      ],
      { cwd: root, stdio: "inherit" },
    );
    api.on("error", (error) => {
      console.error(`Could not start the planning API: ${error.message}`);
      void stop(1);
    });
    api.on("exit", (code) => {
      if (!stopping) {
        console.error(
          `Planning API stopped (${code ?? "signal"}). Check the Python dependencies and restart npm run dev.`,
        );
        void stop(1);
      }
    });
    const deadline = Date.now() + 20000;
    while (!(await apiReady())) {
      if (Date.now() > deadline)
        throw new Error(
          "The planning API did not start. Check the Python error above and install server/requirements.lock.",
        );
      await delay(150);
    }
  } else {
    console.log("Using the running planning API on http://127.0.0.1:8011.");
  }
  web = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../web", import.meta.url)),
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await web.listen();
  web.printUrls();
} catch (error) {
  console.error(error.message);
  await stop(1);
}
