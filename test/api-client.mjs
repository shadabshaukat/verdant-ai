import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function apiFetch(url, options = {}) {
  const token = process.env.VERDANT_TEST_TOKEN || fs.readFileSync(fileURLToPath(new URL("../.secrets/admin_token", import.meta.url)), "utf8").trim();
  return fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } });
}
