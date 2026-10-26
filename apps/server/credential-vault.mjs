import fs from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Credentials stay encrypted in the control store; the key lives outside PostgreSQL. */
export function credentialKey(environment = process.env) {
  let encoded = environment.VERDANT_CREDENTIAL_KEY;
  if (!encoded) {
    try {
      encoded = fs.readFileSync(environment.VERDANT_CREDENTIAL_KEY_FILE || "/run/secrets/credential_key", "utf8").trim();
    } catch {
      throw new Error("Credential vault key is unavailable. Restore the original credential_key secret before using saved connections.");
    }
  }
  const key = Buffer.from(encoded.trim(), "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded.trim())
    throw new Error("VERDANT_CREDENTIAL_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function sealSecret(value, environment = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(environment), iv);
  cipher.setAAD(Buffer.from("verdant-credentials:v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function openSecret(value, environment = process.env) {
  try {
    const [version, iv, tag, encrypted, extra] = String(value).split(".");
    if (version !== "v1" || extra !== undefined || !encrypted) throw new Error();
    const nonce = Buffer.from(iv, "base64url"), authTag = Buffer.from(tag, "base64url");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", credentialKey(environment), nonce);
    decipher.setAAD(Buffer.from("verdant-credentials:v1"));
    decipher.setAuthTag(authTag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"));
  } catch {
    throw new Error("Saved credentials could not be decrypted. Restore the matching credential_key; saved credentials were not changed.");
  }
}
