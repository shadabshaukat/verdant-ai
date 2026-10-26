import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const directory = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(directory))
  .filter((name) => /^core.*\.mjs$/.test(name))
  .sort()
  .map((name) => path.join(directory, name));
if (!files.length) throw new Error("No core unit tests found");
const child = spawn(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
