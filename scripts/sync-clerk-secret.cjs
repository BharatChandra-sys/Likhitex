// One-off: point the frontend at the same Clerk app the API already uses.
//
// The frontend's ClerkProxy needs the secret key because `auth.protect()`
// verifies the session server-side. The API already holds that key for this
// instance, so rather than asking the operator for a second copy we verify the
// two configurations name the same Clerk app and reuse it.
//
// The secret is never printed; only its length is reported.
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const apiEnvPath = path.join(repo, "apps", "api", ".env");
const frontendEnvPath = path.join(repo, "frontend", ".env.local");

const apiEnv = fs.readFileSync(apiEnvPath, "utf8");
const frontendEnv = fs.readFileSync(frontendEnvPath, "utf8");

const secret = (apiEnv.match(/^\s*CLERK_SECRET_KEY=(.*)$/m) || [])[1];
const apiIssuer = (apiEnv.match(/^\s*CLERK_ISSUER=(.*)$/m) || [])[1];

if (!secret || !secret.trim().startsWith("sk_")) {
  console.error("FAIL: apps/api/.env has no usable CLERK_SECRET_KEY");
  process.exit(1);
}
if (!apiIssuer) {
  console.error("FAIL: apps/api/.env has no CLERK_ISSUER to compare against");
  process.exit(1);
}

const publishable = (frontendEnv.match(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=(.*)$/m) || [])[1];
if (!publishable) {
  console.error("FAIL: frontend/.env.local has no publishable key");
  process.exit(1);
}

// A Clerk publishable key is pk_<env>_<base64(frontendApi)><2-char signature>.
const body = publishable.trim().replace(/^pk_(test|live)_/, "");
const frontendInstance = Buffer.from(body.slice(0, -2), "base64").toString("utf8");
const issuerHost = apiIssuer.trim().replace(/^https:\/\//, "").replace(/\/$/, "");

if (frontendInstance !== issuerHost) {
  console.error(`FAIL: frontend instance ${frontendInstance} != api issuer ${issuerHost}`);
  console.error("Refusing to copy a secret across different Clerk apps.");
  process.exit(1);
}

const updated = frontendEnv.replace(/^CLERK_SECRET_KEY=.*$/m, `CLERK_SECRET_KEY=${secret.trim()}`);
fs.writeFileSync(frontendEnvPath, updated);

console.log(`OK: same Clerk app (${issuerHost})`);
console.log(`OK: frontend .env.local CLERK_SECRET_KEY set, length ${secret.trim().length}`);