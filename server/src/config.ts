import "dotenv/config";
export const config = {
  port:Number(process.env.PORT||4000),
  db:process.env.DATABASE_PATH||"./data/tdm.sqlite",
  corsOrigin:process.env.CORS_ORIGIN||"http://localhost:5173",
  maxZipMb:Number(process.env.MAX_ZIP_MB||20),
  githubToken:process.env.GITHUB_TOKEN||"",
  adminJwtSecret:process.env.ADMIN_JWT_SECRET||"development-secret-change-this-32-bytes-min",
  adminUsername:process.env.ADMIN_USERNAME||"admin",
  adminPassword:process.env.ADMIN_PASSWORD||"change-me",
  rpc:{
    ethereum:process.env.RPC_ETHEREUM||"",
    sepolia:process.env.RPC_SEPOLIA||"",
    arbitrum:process.env.RPC_ARBITRUM||"",
    base:process.env.RPC_BASE||""
  }
};
