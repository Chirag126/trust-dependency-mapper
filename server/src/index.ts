import "./runtime";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import { analyzeAddress, analyzeFiles, analyzeGithub } from "./analyzer";
import { compareAnalyses, blastRadius } from "./compare";
import { db, analytics, getAnalysis, getAnalysisForUser, listAnalyses, listAnalysesForUser, saveAnalysis, saveWatch, listWatch, getWatch, updateWatch, ensureAdminUser, logEvent, startWatchRun, updateWatchRun, getWatchRun, saveWatchSnapshot, listWatchSnapshots, createUser, createOrganization, listOrganizationsForUser, getOrganization, getMembership, listMembers, addMember, changeMemberRole, removeMember, orgUsage, reserveOrgAnalysis, setOrganizationSubscription, saveBillingEvent, markBillingEventProcessed, getAnalysisOrganization } from "./db";
import { normalizeGithub, safeSession } from "./utils";
import { networks, withRetry } from "./chain";
import { login, refresh, requireAdmin, userLogin, requireUser } from "./auth";
import { buildSecurityReport } from "./report";
import { buildAiSecurityReport } from "./aiReport";

ensureAdminUser(config.adminUsername, config.adminPassword);

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "2mb", verify: (req:any, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(rateLimit({ windowMs: 60_000, max: 80, standardHeaders: true, legacyHeaders: false }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxZipMb * 1024 * 1024 } });
function session(req: express.Request) {
  return safeSession(req.header("x-anonymous-session") || "anon");
}

function analysisErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (/rate.?limit|too many requests|\b429\b/i.test(message)) return 429;

  if (/timed out|RPC is not configured|network error|network unavailable|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|SERVER_ERROR|NETWORK_ERROR|ETIMEDOUT|service unavailable/i.test(message)) {
    return 503;
  }

  return 400;
}

async function admin(req: express.Request) {
  return requireAdmin(req.header("authorization")?.replace(/^Bearer\s+/i, ""));
}


function bearer(req:express.Request) { return req.header("authorization")?.replace(/^Bearer\\s+/i,""); }
async function orgContext(req:express.Request,res:express.Response,minimum:"member"|"admin"|"owner"="member") {
 const user=await requireUser(bearer(req)); if(!user){res.status(401).json({error:"Sign in with an account to access organization resources"});return null;}
 const orgId=String(req.header("x-organization-id")||"");
 if(!orgId){res.status(400).json({error:"x-organization-id header is required"});return null;}
 const org=getOrganization(orgId),membership=getMembership(orgId,user.id);
 if(!org||!membership){res.status(404).json({error:"Organization not found"});return null;}
 const rank={member:1,admin:2,owner:3};
 if(rank[membership.role]<rank[minimum]){res.status(403).json({error:"Your organization role does not permit this action"});return null;}
 return {user,org,membership};
}
app.post("/api/accounts/register",(req,res)=>{
 const p=z.object({email:z.string().email().max(254),password:z.string().min(10).max(200)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Provide a valid email and password of at least 10 characters"});
 try { res.status(201).json(createUser(p.data.email,p.data.password)); } catch(e:any) { res.status(409).json({error:e.message||"Account creation failed"}); }
});
app.post("/api/accounts/login",async(req,res)=>{
 const p=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Email and password required"});
 const out=await userLogin(p.data.email,p.data.password); if(!out)return res.status(401).json({error:"Invalid credentials"}); res.json(out);
});
app.get("/api/organizations",async(req,res)=>{
 const user=await requireUser(bearer(req));if(!user)return res.status(401).json({error:"Sign in required"});
 res.json(listOrganizationsForUser(user.id));
});
app.post("/api/organizations",async(req,res)=>{
 const user=await requireUser(bearer(req));if(!user)return res.status(401).json({error:"Sign in required"});
 const p=z.object({name:z.string().trim().min(2).max(80)}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Organization name must be 2-80 characters"});
 res.status(201).json(createOrganization(user.id,p.data.name));
});
app.get("/api/organizations/members",async(req,res)=>{
 const ctx=await orgContext(req,res);if(!ctx)return;
 res.json(listMembers(ctx.org.id));
});
app.post("/api/organizations/members",async(req,res)=>{
 const ctx=await orgContext(req,res,"admin");if(!ctx)return;
 const p=z.object({email:z.string().email(),role:z.enum(["admin","member"])}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Valid email and role (admin/member) required"});
 try{res.status(201).json(addMember(ctx.org.id,p.data.email,p.data.role));}catch(e:any){res.status(409).json({error:e.message||"Could not add member"});}
});
app.patch("/api/organizations/members/:userId",async(req,res)=>{
 const ctx=await orgContext(req,res,"admin");if(!ctx)return;
 const p=z.object({role:z.enum(["admin","member"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Role must be admin or member"});
 try{if(!changeMemberRole(ctx.org.id,req.params.userId,p.data.role))return res.status(404).json({error:"Member not found"});res.json({ok:true});}catch(e:any){res.status(409).json({error:e.message});}
});
app.delete("/api/organizations/members/:userId",async(req,res)=>{
 const ctx=await orgContext(req,res,"admin");if(!ctx)return;
 try{if(!removeMember(ctx.org.id,req.params.userId))return res.status(404).json({error:"Member not found"});res.json({ok:true});}catch(e:any){res.status(409).json({error:e.message});}
});
app.get("/api/organizations/usage",async(req,res)=>{
 const ctx=await orgContext(req,res);if(!ctx)return;res.json(orgUsage(ctx.org.id));
});
app.post("/api/billing/webhook",async(req:any,res)=>{
 const secret=process.env.BILLING_WEBHOOK_SECRET||"";
 if(!secret)return res.status(503).json({error:"Billing webhooks are disabled until BILLING_WEBHOOK_SECRET is configured"});
 const signature=String(req.header("x-billing-signature")||"");
 const expected=await import("node:crypto").then(({default:crypto})=>crypto.createHmac("sha256",secret).update(req.rawBody||Buffer.from("")).digest("hex"));
 const crypto=await import("node:crypto");
 const a=Buffer.from(signature),b=Buffer.from(expected);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:"Invalid billing webhook signature"});
 const p=z.object({id:z.string().min(1),type:z.string().min(1),organizationId:z.string().uuid(),plan:z.enum(["free","team"]).optional(),status:z.string().optional(),customerId:z.string().optional(),subscriptionId:z.string().optional()}).safeParse(req.body);
 if(!p.success)return res.status(400).json({error:"Invalid billing event payload"});
 if(!getOrganization(p.data.organizationId))return res.status(404).json({error:"Organization not found"});
 if(!saveBillingEvent(p.data.id,"generic-hmac",p.data.type,req.body))return res.json({received:true,duplicate:true});
 if(p.data.type==="subscription.updated"||p.data.type==="subscription.created"||p.data.type==="subscription.deleted"){
  const status=p.data.type==="subscription.deleted"?"canceled":(p.data.status||"active");
  const plan=status==="active"?(p.data.plan||"team"):"free";
  setOrganizationSubscription(p.data.organizationId,plan,status,p.data.customerId,p.data.subscriptionId);
 }
 markBillingEventProcessed(p.data.id);res.json({received:true});
});

async function optionalOrgContext(req:express.Request,res:express.Response) {
 if(!req.header("x-organization-id"))return null;
 return await orgContext(req,res,"member")||false;
}
async function readableAnalysis(req:express.Request,id:string) {
 const orgId=getAnalysisOrganization(id);
 if(!orgId)return getAnalysis(id);
 const user=await requireUser(bearer(req));if(!user||!getMembership(orgId,user.id))return null;
 return getAnalysisForUser(id,user.id);
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "trust-dependency-mapper", networks }));
app.post("/api/auth/login", async (req, res) => {
  const p = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Credentials required" });
  const out = await login(p.data.username, p.data.password);
  if (!out) return res.status(401).json({ error: "Invalid credentials" });
  res.json(out);
});
app.post("/api/auth/refresh", async (req, res) => {
  const p = z.object({ refresh: z.string().min(20) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Refresh token required" });
  const out = await refresh(p.data.refresh);
  if (!out) return res.status(401).json({ error: "Invalid refresh token" }); res.json(out);
});

app.post("/api/analyze/address", async (req, res) => {
  const org = await optionalOrgContext(req,res); if(org===false)return;\n  if(org){try{reserveOrgAnalysis(org.org.id);}catch(e:any){return res.status(429).json({error:e.message});}}
  const p = z.object({ address: z.string(), network: z.enum(networks as [string, ...string[]]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Address and supported network are required" });
  try {
    const a = await analyzeAddress(p.data.address, p.data.network as any);
    saveAnalysis(a, session(req), org?.org.id);
    res.json(a);
  }
  catch (e: any) {
    res.status(400).json({ error: e.message || "Analysis failed" });
  }
});
app.post("/api/analyze/github", async (req, res) => {
  const org = await optionalOrgContext(req,res); if(org===false)return;
  const p = z.object({ url: z.string().url() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Valid GitHub repository URL required" });
  try {
    const { owner, repo } = normalizeGithub(p.data.url);
    const a = await analyzeGithub(owner, repo);
    saveAnalysis(a, session(req), org?.org.id);
    res.json(a);
  }
  catch (e: any) {
    console.error("GitHub analysis failed:", e);
    res.status(400).json({ error: e.message || "GitHub analysis failed" });
  }
});
function extractZip(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > 1000) throw new Error("ZIP contains too many entries");
  const out: { path: string; content: string; }[] = [];
  for (const e of entries) {
    if (e.isDirectory) continue; const n = path.posix.normalize(e.entryName.replace(/\\/g, "/"));
    if (n.startsWith("../") || n.includes("/../") || n.startsWith("/")) throw new Error("Unsafe ZIP path");
    if (!/\.(sol|json)$/i.test(n)) continue; const data = e.getData();
    if (data.length <= 1_000_000) out.push({ path: n, content: data.toString("utf8") });
  } return out;
}
app.post("/api/analyze/zip", upload.single("project"), async (req, res) => {
  const org = await optionalOrgContext(req,res); if(org===false)return;
  if (!req.file) return res.status(400).json({ error: "Upload a .zip Solidity project" });
  try {
    const files = extractZip(req.file.buffer);
    if (!files.some(f => f.path.endsWith(".sol"))) return res.status(400).json({ error: "ZIP contains no Solidity files" });
    const a = await analyzeFiles(files, req.file.originalname);
    saveAnalysis(a, session(req));
    res.json(a);
  } catch (e: any) {
    res.status(400).json({ error: e.message || "ZIP analysis failed" });
  }
});
app.get("/api/analyses", async (req, res) => {
 const user=await requireUser(bearer(req));
 res.json(user?listAnalysesForUser(user.id,Math.min(Number(req.query.limit||50),200)):listAnalyses(Math.min(Number(req.query.limit||50),200)));
});
app.get("/api/analyses/:id", async (req, res) => {
  const a = await readableAnalysis(req,req.params.id);
  if (!a) return res.status(404).json({ error: "Analysis not found" }); res.json(a);
});
app.get("/api/analyses/:id/report", async (req, res) => {
  const a = getAnalysis(req.params.id);
  if (!a) return res.status(404).json({ error: "Analysis not found" });
  res.json(buildSecurityReport(a));
});
app.get("/api/analyses/:id/report/ai", async (req, res) => {
  const a = getAnalysis(req.params.id);
  if (!a) return res.status(404).json({ error: "Analysis not found" });
  res.json(await buildAiSecurityReport(a));
});
app.post("/api/compare", async (req, res) => {
  const p = z.object({ beforeId: z.string(), afterId: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "beforeId and afterId required" });
  const a = await readableAnalysis(req,p.data.beforeId), b = await readableAnalysis(req,p.data.afterId);
  if (!a || !b) return res.status(404).json({ error: "One or both analyses not found" });
  res.json(compareAnalyses(a, b));
});
app.get("/api/analyses/:id/blast-radius/:dependencyId", async (req, res) => {
  const a = getAnalysis(req.params.id);
  if (!a) return res.status(404).json({ error: "Analysis not found" }); res.json(blastRadius(a, req.params.dependencyId));
});
app.post("/api/watchlist", async (req, res) => {
 const org=await optionalOrgContext(req,res);if(org===false)return;
  const p = z.object({ name: z.string().min(1).max(100), analysisId: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "name and analysisId required" });
  const a = getAnalysis(p.data.analysisId);
  if (!a) return res.status(404).json({ error: "Analysis not found" }); res.json({ id: saveWatch(p.data.name, a.inputType, a.inputLabel, a.network, a, org?.org.id) });
});
app.get("/api/watchlist", async (req,res)=>{
 const orgId=req.header("x-organization-id");
 if(orgId){const ctx=await orgContext(req,res);if(!ctx)return res.status(403).json({error:"Organization access required"});return res.json(listWatch(ctx.org.id));}
 res.json(listWatch());
});
app.get("/api/watchlist/:id/status", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || !getWatch(id)) return res.status(404).json({ error: "Watch not found" });
  res.json(getWatchRun(id));
});
app.get("/api/watchlist/:id/snapshots", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || !getWatch(id)) return res.status(404).json({ error: "Watch not found" });
  res.json(listWatchSnapshots(id, Number(req.query.limit || 20)));
});
app.post("/api/watchlist/:id/check", async (req, res) => {
  const id = Number(req.params.id);
  const w = Number.isSafeInteger(id) && id > 0 ? getWatch(id) : null;
  if (!w) return res.status(404).json({ error: "Watch not found" });
  if (w.input_type !== "address") return res.status(400).json({ error: "Live watch checks currently support contract addresses" });
  startWatchRun(w.id);
  try {
    updateWatchRun(w.id, { progress: 10, message: "Checking configured RPC and reading contract state" });
    let failedAttempts = 0;
    const current = await withRetry(
      () => analyzeAddress(w.input_label, w.network),
      { attempts: 3, baseDelayMs: 300, maxDelayMs: 1600, onRetry: (attempt, error) => {
        failedAttempts = attempt;
        updateWatchRun(w.id, { attempts: attempt, progress: 15, message: `Attempt ${attempt} failed; backing off before retry`, error: error instanceof Error ? error.message : String(error) });
      }}
    );
    updateWatchRun(w.id, { progress: 75, attempts: failedAttempts + 1, message: "Comparing current dependency graph with saved baseline", error: null });
    const baseline = JSON.parse(w.baseline_json);
    const diff = compareAnalyses(baseline, current);
    saveAnalysis(current, session(req));
    const block = Number(current.metadata?.block);
    saveWatchSnapshot({
      watchId: w.id, blockNumber: Number.isFinite(block) ? block : null, status: current.status,
      analysisId: current.id,
      summary: { dependencyCount: current.summary.dependencyCount, critical: current.summary.critical, high: current.summary.high, upgradeable: current.summary.upgradeable },
      diff: { summary: diff.summary, added: diff.added.map(d => ({ id: d.id, name: d.name, type: d.type, severity: d.severity, address: d.address })),
        removed: diff.removed.map(d => ({ id: d.id, name: d.name, type: d.type, severity: d.severity, address: d.address })),
        changed: diff.changed.map((d: any) => ({ before: { name: d.before.name, severity: d.before.severity, capabilities: d.before.capabilities }, after: { name: d.after.name, severity: d.after.severity, capabilities: d.after.capabilities } })) }
    });
    updateWatch(w.id, current);
    updateWatchRun(w.id, { status: "completed", progress: 100, message: "Snapshot saved; comparison complete", error: null, finished: true });
    res.json({ current, diff, status: getWatchRun(w.id), snapshots: listWatchSnapshots(w.id, 10) });
  } catch (e: any) {
    const message = e?.message || "Watch check failed";
    saveWatchSnapshot({ watchId: w.id, status: "failed", summary: {}, diff: {}, error: message });
    updateWatchRun(w.id, { status: "failed", progress: 100, message: "Monitoring check failed", error: message, finished: true });
    res.status(503).json({ error: message, status: getWatchRun(w.id) });
  }
});
app.get("/api/admin/analytics", async (req, res) => {
  const user = await admin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json(analytics());
});
app.get("/api/admin/audit", async (req, res) => {
  const user = await admin(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  const rows = db.prepare("SELECT created_at,event,input_type,network,duration_ms,status,metadata_json FROM events ORDER BY created_at DESC LIMIT 500").all();
  res.json(rows);
});
// Central error boundary catches parser/multipart middleware errors that occur before route handlers.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `ZIP exceeds the ${config.maxZipMb} MB upload limit.` });
  if (err?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Unexpected upload field. Use the project ZIP upload field." });
  console.error("Unhandled API error:", err?.message || err);
  return res.status(status >= 400 && status < 500 ? status : 500).json({ error: status >= 500 ? "Unexpected server error. Check the API logs and retry." : (err?.message || "Invalid request") });
});

app.listen(config.port, () => console.log(`TDM API listening on http://localhost:${config.port}`));
