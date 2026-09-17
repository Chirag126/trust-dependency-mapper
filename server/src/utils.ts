import crypto from "node:crypto";

export function id(prefix = "an") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function shortAddress(a?: string) {
  if (!a) return "";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function safeSession(value?: string) {
  if (!value) return "anon";
  return value.slice(0, 80).replace(/[^a-zA-Z0-9._-]/g, "");
}

export function now() {
  return new Date().toISOString();
}

export function normalizeGithub(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid GitHub URL"); }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") throw new Error("Only github.com repositories are supported");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub URL must look like https://github.com/owner/repository");
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

export function severityRank(s: string) {
  return ({ critical: 5, high: 4, medium: 3, low: 2, info: 1 } as any)[s] || 0;
}
