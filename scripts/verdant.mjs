#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SECRET_NAMES,
  loadDeploymentConfig,
  composeArguments,
} from "./deployment-config.mjs";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function prepareEnvironment(root, mode) {
  if (mode && !["external", "bundled"].includes(mode))
    throw new Error("--ollama must be bundled or external");
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile))
    fs.writeFileSync(
      envFile,
      fs.readFileSync(path.join(root, ".env.example")),
      { flag: "wx", mode: 0o600 },
    );
  if (mode) {
    const existing = fs.readFileSync(envFile, "utf8");
    fs.writeFileSync(
      envFile,
      /^OLLAMA_MODE=/m.test(existing)
        ? existing.replace(/^OLLAMA_MODE=.*$/m, `OLLAMA_MODE=${mode}`)
        : existing + `\nOLLAMA_MODE=${mode}\n`,
    );
  }
}

export function prepareSecrets(root) {
  const dir = path.join(root, ".secrets");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory())
    throw new Error(".secrets must be a real directory, not a symbolic link");
  const present = SECRET_NAMES.filter((name) =>
    fs.existsSync(path.join(dir, name)),
  );
  if (present.length && present.length !== SECRET_NAMES.length)
    throw new Error(
      "The existing .secrets directory is incomplete. Restore its matching files; setup will not replace part of an existing credential set.",
    );
  for (const name of SECRET_NAMES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || !stat.size)
        throw new Error(`Secret file ${name} must be a nonempty regular file`);
    } else
      fs.writeFileSync(file, randomBytes(24).toString("hex") + "\n", {
        flag: "wx",
        mode: 0o600,
      });
  }
  const keyFile = path.join(dir, "credential_key");
  const marker = path.join(dir, "vault-initialized");
  if (!fs.existsSync(keyFile) && fs.existsSync(marker))
    throw new Error("The vault key is missing. Restore the original .secrets/credential_key; generating a replacement would lose access to saved connection credentials.");
  if (!fs.existsSync(keyFile))
    fs.writeFileSync(keyFile, randomBytes(32).toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, "Back up credential_key together with the control database.\n", { flag: "wx", mode: 0o600 });
  const adminFile = path.join(dir, "admin_token");
  if (!fs.existsSync(adminFile)) fs.writeFileSync(adminFile, randomBytes(32).toString("base64url") + "\n", { flag: "wx", mode: 0o600 });
  for (const file of [keyFile, adminFile]) if (!fs.lstatSync(file).isFile()) throw new Error("Platform secrets must be regular files");
}

export async function runProcess(
  command,
  args,
  {
    root = projectRoot,
    env = process.env,
    capture = false,
    allowFailure = false,
  } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
    }
    child.on("error", () =>
      reject(
        new Error(
          `Unable to run ${command}. Install Docker with Compose v2 and ensure it is available on PATH.`,
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0 || allowFailure
        ? resolve({ code, output })
        : reject(new Error(`${command} exited with status ${code}`)),
    );
  });
}

async function preserveVolumeCredentials(root, config, runner) {
  if (
    SECRET_NAMES.every((name) =>
      fs.existsSync(path.join(root, ".secrets", name)),
    )
  )
    return;
  for (const suffix of ["control_data", "primary_data", "standby_data"]) {
    const existing = await runner(
      "docker",
      ["volume", "inspect", `${config.COMPOSE_PROJECT_NAME}_${suffix}`],
      { root, env: config, capture: true, allowFailure: true },
    );
    if (existing.code === 0)
      throw new Error(
        "Existing database volumes were found but matching .secrets files are missing. Restore the original credentials before starting; setup cannot rotate existing database passwords.",
      );
    if (!/no such volume/i.test(existing.output || ""))
      throw new Error(
        "Unable to verify existing database volumes. Credential generation was refused; check Docker access.",
      );
  }
}

export async function main(
  args = process.argv.slice(2),
  root = projectRoot,
  { run = runProcess } = {},
) {
  const command = args[0] || "help";
  const modeArg = args.find((arg) => arg.startsWith("--ollama="));
  const unknown = args
    .slice(1)
    .filter(
      (arg) => arg !== modeArg && !(command === "models" && arg === "--check"),
    );
  if (unknown.length || (modeArg && command !== "setup"))
    throw new Error(
      "Unsupported arguments. Use setup --ollama=bundled|external or models --check.",
    );
  if (command === "help" || command === "--help") {
    console.log(
      "Usage: node scripts/verdant.mjs setup|start|stop|status|logs|doctor|models|migrate\nsetup [--ollama=bundled|external] creates .env and a fresh credential set.\nmodels [--check] downloads missing configured models, or checks without downloads.\nstop preserves all database and model volumes.",
    );
    return;
  }
  if (
    ![
      "setup",
      "start",
      "stop",
      "status",
      "logs",
      "doctor",
      "models",
      "migrate",
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}`);
  if (command === "setup") {
    prepareEnvironment(root, modeArg?.split("=")[1]);
    const config = loadDeploymentConfig(root);
    let online = false;
    try {
      online =
        (
          await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
            root,
            env: config,
            capture: true,
            allowFailure: true,
          })
        ).code === 0;
    } catch {
      /* Offline setup prepares configuration without replacing any credentials. */
    }
    if (online) {
      await preserveVolumeCredentials(root, config, run);
      prepareSecrets(root);
    }
    console.log(
      `Prepared .env. Ollama mode: ${config.OLLAMA_MODE}. ${online ? "Credential files are ready." : "Credential creation is deferred until Docker is available."}`,
    );
    if (online) console.log("Sign in using the token in .secrets/admin_token. Keep .secrets/credential_key in the matching database backup.");
    return;
  }
  prepareEnvironment(root);
  const config = loadDeploymentConfig(root);
  const execute = (options, capture = false) =>
    run("docker", composeArguments(config, options), {
      root,
      env: config,
      capture,
    });
  await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
    root,
    env: config,
    capture: true,
  });
  if (["start", "models", "migrate", "doctor"].includes(command)) {
    await preserveVolumeCredentials(root, config, run);
    prepareSecrets(root);
  }
  if (command === "status") return void (await execute(["ps", "--all"]));
  if (command === "stop") {
    await execute(["down"]);
    console.log("Stopped Verdant. Database and model volumes were preserved.");
    return;
  }
  if (command === "logs")
    return void (await execute([
      "logs",
      "--tail=100",
      "--follow",
      "app",
      "worker",
    ]));
  if (command === "doctor") {
    await execute(["version"]);
    await execute(["config", "--quiet"]);
    await execute([
      "run",
      "--rm",
      "--no-deps",
      "--build",
      "--entrypoint",
      "node",
      "app",
      "scripts/models.mjs",
      "check",
    ]);
    console.log(
      "Docker, Compose, configuration and both configured model endpoints passed.",
    );
    return;
  }
  if (command === "migrate") {
    await execute(["up", "-d", "--build", "--wait", "control"]);
    await execute(["run", "--rm", "--build", "migrate"]);
    return;
  }
  await execute([
    "build",
    ...(command === "start" ? ["app", "control", ...(config.DEPLOYMENT_MODE === "production" ? [] : ["primary"])] : ["app"]),
  ]);
  if (config.OLLAMA_MODE === "bundled")
    await execute(["up", "-d", "--wait", "ollama"]);
  if (command === "models" || config.MODEL_SETUP !== "skip") await execute([
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "app",
    "scripts/models.mjs",
    args.includes("--check") ? "check" : "ensure",
  ]);
  if (command === "start") {
    await execute(["up", "-d", "--wait"]);
    const displayHost =
      config.APP_HOST === "0.0.0.0" || config.APP_HOST === "::"
        ? "127.0.0.1"
        : config.APP_HOST;
    console.log(
      `Verdant DBA: http://${displayHost.includes(":") ? `[${displayHost}]` : displayHost}:${config.APP_PORT}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Verdant: ${error.message}`);
    process.exitCode = 1;
  });
}
