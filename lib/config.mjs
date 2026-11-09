import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
export const root = process.env.XMLY_HOME || join(homedir(), ".ximalaya-cli");
export function paths(profile = "default") {
  if (!/^[a-zA-Z0-9_-]+$/.test(profile))
    throw new Error("profile 仅支持字母、数字、下划线和横线");
  return {
    root,
    auth: join(root, "profiles", profile, "auth.json"),
    signer: join(root, "profiles", profile, "signer.json"),
    jobs: join(root, "profiles", profile, "jobs.json"),
    config: join(root, "config.json"),
  };
}
export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
}
export async function saveJson(path, value) {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(tmp, path);
  await chmod(path, 0o600);
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(cookie|cookies|authorization|.*token.*|.*secret.*|password|.*signature.*|signedurl)$/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    try {
      const u = new URL(value);
      for (const k of u.searchParams.keys())
        if (/token|sign|secret|authorization|session/i.test(k))
          u.searchParams.set(k, "[REDACTED]");
      u.username = "";
      u.password = "";
      return u.href;
    } catch {}
  }
  return value;
}
