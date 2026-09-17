const [major, minor, patch] = process.versions.node.split(".").map(Number);

if (major !== 26 || minor < 8 || (minor === 8 && patch < 2)) {
  throw new Error(`Trust Dependency Mapper requires Node.js >=26.8.2 and <27. Detected ${process.versions.node}.`);
}

export const runtime = { node: process.versions.node, npm: process.env.npm_config_user_agent ?? "unknown" };
