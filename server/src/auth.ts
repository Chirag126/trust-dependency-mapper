import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";
import { verifyAdmin, consumeRefreshToken, saveRefreshToken, verifyUser } from "./db";

const secret = Buffer.from(config.adminJwtSecret);
if (secret.length < 32) console.warn("WARNING: ADMIN_JWT_SECRET should be at least 32 bytes in production.");

export async function login(username: string, password: string) {
  const user = verifyAdmin(username, password);
  if (!user) return null;
  const access = await new SignJWT({ sub: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m").sign(secret);
  const refresh = crypto.randomBytes(48).toString("base64url");
  saveRefreshToken(user.id, refresh, new Date(Date.now() + 7 * 86400000).toISOString());
  return { access, refresh, user };
}

export async function refresh(raw: string) {
  const user = consumeRefreshToken(raw);
  if (!user) return null;
  const access = await new SignJWT({ sub: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("15m").sign(secret);
  const next = crypto.randomBytes(48).toString("base64url");
  saveRefreshToken(user.id, next, new Date(Date.now() + 7 * 86400000).toISOString());
  return { access, refresh: next, user: { id: user.id, username: user.username, role: user.role } };
}

export async function requireAdmin(token?: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function userLogin(email:string,password:string) {
 const user=verifyUser(email,password); if(!user)return null;
 const access=await new SignJWT({sub:user.id,email:user.email,kind:"user"}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(secret);
 return {access,user};
}
export async function requireUser(token?:string) {
 if(!token)return null;
 try {
  const {payload}=await jwtVerify(token,secret,{algorithms:["HS256"]});
  if(payload.kind!=="user"||typeof payload.sub!=="string"||typeof payload.email!=="string")return null;
  return {id:payload.sub,email:payload.email};
 } catch { return null; }
}
