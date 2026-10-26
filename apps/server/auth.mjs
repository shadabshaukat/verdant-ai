import fs from "node:fs";
import { createHmac, timingSafeEqual, hkdfSync } from "node:crypto";
import { credentialKey } from "./credential-vault.mjs";

const roles = ["admin", "operator", "viewer"];
const cookieName = "verdant_session";
const fail = (message, statusCode = 401) => Object.assign(new Error(message), { statusCode });
const equal = (left, right) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const tokenFor = (role, environment) => {
  const prefix = `VERDANT_${role.toUpperCase()}_TOKEN`;
  if (environment[prefix]) return environment[prefix].trim();
  try {
    return fs.readFileSync(environment[`${prefix}_FILE`] || (role === "admin" ? "/run/secrets/admin_token" : ""), "utf8").trim();
  } catch { return ""; }
};
export function authConfiguration(environment = process.env) {
  const tokens = Object.fromEntries(roles.map(role => [role, tokenFor(role, environment)]));
  if (tokens.admin.length < 32) throw new Error("An administrator token of at least 32 characters is required. Run npm run setup and mount admin_token.");
  for (const role of roles) if (tokens[role] && tokens[role].length < 32) throw new Error(`${role} token must have at least 32 characters`);
  const configured = roles.filter(role => tokens[role]);
  if (new Set(configured.map(role => tokens[role])).size !== configured.length) throw new Error("Access roles must use different tokens");
  let publicOrigin = null;
  if (environment.VERDANT_PUBLIC_URL) {
    const url = new URL(environment.VERDANT_PUBLIC_URL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("VERDANT_PUBLIC_URL must be an HTTP(S) origin without a path");
    publicOrigin = url.origin;
  }
  const secure = publicOrigin?.startsWith("https:") || environment.VERDANT_COOKIE_SECURE === "true";
  const key = Buffer.from(hkdfSync("sha256", credentialKey(environment), Buffer.alloc(0), "verdant-session:v1", 32));
  const seconds = Number(environment.VERDANT_SESSION_SECONDS || 28800);
  if (!Number.isInteger(seconds) || seconds < 300 || seconds > 86400) throw new Error("VERDANT_SESSION_SECONDS must be between 300 and 86400");
  return { tokens, key, publicOrigin, secure: Boolean(secure), seconds };
}

export function createAuthentication(configuration, now = Date.now) {
  const failures = new Map();
  const mac = value => createHmac("sha256", configuration.key).update(value).digest("base64url");
  const fingerprint = role => mac(configuration.tokens[role]).slice(0, 20);
  const session = req => {
    if (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
      const supplied = req.headers.authorization.slice(7);
      const role = roles.find(role => configuration.tokens[role] && supplied.length < 4096 && equal(supplied, configuration.tokens[role]));
      return role ? { role, authenticated: true, authRequired: true } : null;
    }
    const cookies = String(req.headers.cookie || "").split(";").map(x => x.trim());
    const encoded = cookies.find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!encoded) return null;
    try {
      const [body, signature, extra] = encoded.split(".");
      if (extra || !signature || !equal(mac(body), signature)) return null;
      const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!roles.includes(data.role) || !configuration.tokens[data.role] || data.exp < now() || !equal(data.fingerprint, fingerprint(data.role))) return null;
      return { role: data.role, authenticated: true, authRequired: true };
    } catch { return null; }
  };
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${configuration.secure ? "; Secure" : ""}`;
  return {
    session,
    status(req) { return session(req) || { authenticated: false, role: null, authRequired: true }; },
    assertOrigin(req) {
      const origin = req.headers.origin;
      const expected = configuration.publicOrigin || `${configuration.secure ? "https" : "http"}://${req.headers.host}`;
      if (origin && origin !== expected) throw fail("Request origin is not allowed", 403);
      if (req.headers["sec-fetch-site"] === "cross-site") throw fail("Cross-site requests are not allowed", 403);
    },
    login(req, res, token) {
      const key = req.socket?.remoteAddress || "unknown";
      const previous = failures.get(key);
      if (previous?.until > now() && previous.count >= 8) throw fail("Too many sign-in attempts. Try again in five minutes.", 429);
      const role = roles.find(role => configuration.tokens[role] && typeof token === "string" && token.length < 4096 && equal(token, configuration.tokens[role]));
      if (!role) {
        const entry = previous?.until > now() ? previous : { count: 0, until: now() + 300000 };
        entry.count++; failures.set(key, entry);
        if (failures.size > 1000) for (const [ip, item] of failures) if (item.until < now()) failures.delete(ip);
        throw fail("The access token is invalid");
      }
      failures.delete(key);
      const body = Buffer.from(JSON.stringify({ role, exp: now() + configuration.seconds * 1000, fingerprint: fingerprint(role) })).toString("base64url");
      res.setHeader("set-cookie", cookie(`${body}.${mac(body)}`, configuration.seconds));
      return { authenticated: true, role, authRequired: true };
    },
    logout(res) { res.setHeader("set-cookie", cookie("", 0)); return { authenticated: false, role: null, authRequired: true }; },
    authorize(req, required = "viewer") {
      const identity = session(req);
      if (!identity) throw fail("Sign in to Verdant to continue");
      if (roles.indexOf(identity.role) > roles.indexOf(required)) throw fail("Your access role cannot perform this operation", 403);
      return identity;
    },
  };
}
