import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealSecret, openSecret } from "../apps/server/credential-vault.mjs";
import { createAuthentication, authConfiguration } from "../apps/server/auth.mjs";

const environment = () => ({ VERDANT_CREDENTIAL_KEY: randomBytes(32).toString("base64"), VERDANT_ADMIN_TOKEN: randomBytes(32).toString("base64url"), VERDANT_VIEWER_TOKEN: randomBytes(32).toString("base64url") });
test("vault encrypts JSON with fresh nonces and rejects tampering or a different key", () => {
  const env = environment(), value = { password: "private%literal", token: "test-key" };
  const first = sealSecret(value, env), second = sealSecret(value, env);
  assert.notEqual(first, second);
  assert.ok(!first.includes(value.password));
  assert.deepEqual(openSecret(first, env), value);
  assert.throws(() => openSecret(first, environment()), /could not be decrypted/);
  const parts = first.split("."); parts[3] = "AAAA";
  assert.throws(() => openSecret(parts.join("."), env), /could not be decrypted/);
  assert.throws(() => sealSecret(value, { VERDANT_CREDENTIAL_KEY: "bad" }), /32-byte/);
});
test("sessions expire, enforce roles, remain HttpOnly, and reject changed role signatures", () => {
  let time = 1000, setCookie;
  const env = environment(), config = authConfiguration(env), auth = createAuthentication(config, () => time);
  const req = { headers: { host: "localhost:8090" }, socket: { remoteAddress: "127.0.0.1" } };
  const res = { setHeader(_key, value) { setCookie = value; } };
  assert.equal(auth.status(req).authenticated, false);
  assert.throws(() => auth.authorize(req), /Sign in/);
  assert.equal(auth.login(req, res, env.VERDANT_VIEWER_TOKEN).role, "viewer");
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  req.headers.cookie = setCookie.split(";")[0];
  assert.equal(auth.authorize(req).role, "viewer");
  assert.throws(() => auth.authorize(req, "operator"), error => error.statusCode === 403);
  const [name, signed] = req.headers.cookie.split("="), [payload, sig] = signed.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url")); data.role = "admin";
  req.headers.cookie = `${name}=${Buffer.from(JSON.stringify(data)).toString("base64url")}.${sig}`;
  assert.equal(auth.session(req), null);
  req.headers.cookie = setCookie.split(";")[0];
  time += 86400001;
  assert.equal(auth.session(req), null);
});
test("secure deployment rejects foreign origins and sign-in brute force", () => {
  const env = { ...environment(), VERDANT_PUBLIC_URL: "https://verdant.example.test" }, config = authConfiguration(env), auth = createAuthentication(config);
  assert.equal(config.secure, true);
  assert.throws(() => auth.assertOrigin({ headers: { origin: "https://evil.test", host: "verdant.example.test" } }), error => error.statusCode === 403);
  auth.assertOrigin({ headers: { origin: env.VERDANT_PUBLIC_URL, host: "internal:8090" } });
  const req = { headers: {}, socket: { remoteAddress: "test-client" } }, res = { setHeader() {} };
  for (let i = 0; i < 8; i++) assert.throws(() => auth.login(req, res, "wrong"), error => error.statusCode === 401);
  assert.throws(() => auth.login(req, res, env.VERDANT_ADMIN_TOKEN), error => error.statusCode === 429);
  assert.equal(auth.session({ headers: { authorization: `Bearer ${env.VERDANT_ADMIN_TOKEN}` } }).role, "admin");
});
