import "dotenv/config";
export const config = {
  port: Number(process.env.PORT || 4000),
  db: process.env.DATABASE_PATH || "./data/tdm.sqlite",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  maxZipMb: Number(process.env.MAX_ZIP_MB || 20),
  githubToken: process.env.GITHUB_TOKEN || "",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  razorpayTeamPlanId: process.env.RAZORPAY_TEAM_PLAN_ID || "",
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || "development-secret-change-this-32-bytes-min",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  rpc: {
    ethereum: process.env.RPC_ETHEREUM || "",
    sepolia: process.env.RPC_SEPOLIA || "",
    arbitrum: process.env.RPC_ARBITRUM || "",
    base: process.env.RPC_BASE || ""
  }
};

if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32 || /replace-with|change-me|example|your-secret/i.test(process.env.ADMIN_JWT_SECRET) || process.env.ADMIN_JWT_SECRET === "development-secret-change-this-32-bytes-min") {
    throw new Error("Production startup requires a unique ADMIN_JWT_SECRET of at least 32 characters.");
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "change-me") {
    throw new Error("Production startup requires a non-default ADMIN_PASSWORD.");
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error("Production startup requires an explicit CORS_ORIGIN.");
  }
}
