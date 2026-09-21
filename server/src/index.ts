import "./runtime";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "node:path";
import { z } from "zod";
import { config } from "./config";
import { analyzeAddress, analyzeFiles, analyzeGithub } from "./analyzer";
import { compareAnalyses, blastRadius } from "./compare";
import { db, analytics, getAnalysis, listAnalyses, saveAnalysis, saveWatch, listWatch, getWatch, updateWatch, ensureAdminUser, logEvent } from "./db";
import { normalizeGithub, safeSession } from "./utils";
import { networks } from "./chain";
import { login, refresh, requireAdmin } from "./auth";

ensureAdminUser(config.adminUsername,config.adminPassword);

const app=express();
app.use(cors({origin:config.corsOrigin}));
app.use(express.json({limit:"2mb"}));
app.use(rateLimit({windowMs:60_000,max:80,standardHeaders:true,legacyHeaders:false}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxZipMb*1024*1024}});
function session(req:express.Request){return safeSession(req.header("x-anonymous-session")||"anon");}
async function admin(req:express.Request){return requireAdmin(req.header("authorization")?.replace(/^Bearer\s+/i,""));}

app.get("/api/health",(_,res)=>res.json({ok:true,service:"trust-dependency-mapper",networks}));
app.post("/api/auth/login",async(req,res)=>{
  const p=z.object({username:z.string().min(1),password:z.string().min(1)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Credentials required"});
  const out=await login(p.data.username,p.data.password);
  if(!out)return res.status(401).json({error:"Invalid credentials"});
  res.json(out);
});
app.post("/api/auth/refresh",async(req,res)=>{
  const p=z.object({refresh:z.string().min(20)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Refresh token required"});
  const out=await refresh(p.data.refresh); if(!out)return res.status(401).json({error:"Invalid refresh token"}); res.json(out);
});

app.post("/api/analyze/address",async(req,res)=>{
  const p=z.object({address:z.string(),network:z.enum(networks as [string,...string[]])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Address and supported network are required"});
  try{const a=await analyzeAddress(p.data.address,p.data.network as any);saveAnalysis(a,session(req));res.json(a);}
  catch(e:any){res.status(400).json({error:e.message||"Analysis failed"});}
});
app.post("/api/analyze/github",async(req,res)=>{
  const p=z.object({url:z.string().url()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Valid GitHub repository URL required"});
  try{const {owner,repo}=normalizeGithub(p.data.url);const a=await analyzeGithub(owner,repo);saveAnalysis(a,session(req));res.json(a);}
  catch(e:any){console.error("GitHub analysis failed:",e);res.status(400).json({error:e.message||"GitHub analysis failed"});}
});
function extractZip(buffer:Buffer){
  const zip=new AdmZip(buffer);const entries=zip.getEntries();if(entries.length>1000)throw new Error("ZIP contains too many entries");
  const out:{path:string;content:string}[]=[];
  for(const e of entries){if(e.isDirectory)continue;const n=path.posix.normalize(e.entryName.replace(/\\/g,"/"));
    if(n.startsWith("../")||n.includes("/../")||n.startsWith("/"))throw new Error("Unsafe ZIP path");
    if(!/\.(sol|json)$/i.test(n))continue;const data=e.getData();if(data.length<=1_000_000)out.push({path:n,content:data.toString("utf8")});
  } return out;
}
app.post("/api/analyze/zip",upload.single("project"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Upload a .zip Solidity project"});
  try{const files=extractZip(req.file.buffer);if(!files.some(f=>f.path.endsWith(".sol")))return res.status(400).json({error:"ZIP contains no Solidity files"});
    const a=await analyzeFiles(files,req.file.originalname);saveAnalysis(a,session(req));res.json(a);
  }catch(e:any){res.status(400).json({error:e.message||"ZIP analysis failed"});}
});
app.get("/api/analyses",(req,res)=>res.json(listAnalyses(Math.min(Number(req.query.limit||50),200))));
app.get("/api/analyses/:id",(req,res)=>{const a=getAnalysis(req.params.id);if(!a)return res.status(404).json({error:"Analysis not found"});res.json(a);});
app.post("/api/compare",(req,res)=>{
  const p=z.object({beforeId:z.string(),afterId:z.string()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"beforeId and afterId required"});
  const a=getAnalysis(p.data.beforeId),b=getAnalysis(p.data.afterId);if(!a||!b)return res.status(404).json({error:"One or both analyses not found"});
  res.json(compareAnalyses(a,b));
});
app.get("/api/analyses/:id/blast-radius/:dependencyId",(req,res)=>{
  const a=getAnalysis(req.params.id);if(!a)return res.status(404).json({error:"Analysis not found"});res.json(blastRadius(a,req.params.dependencyId));
});
app.post("/api/watchlist",(req,res)=>{
  const p=z.object({name:z.string().min(1).max(100),analysisId:z.string()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"name and analysisId required"});
  const a=getAnalysis(p.data.analysisId);if(!a)return res.status(404).json({error:"Analysis not found"});res.json({id:saveWatch(p.data.name,a.inputType,a.inputLabel,a.network,a)});
});
app.get("/api/watchlist",(_,res)=>res.json(listWatch()));
app.post("/api/watchlist/:id/check",async(req,res)=>{
  const w=getWatch(Number(req.params.id));if(!w)return res.status(404).json({error:"Watch not found"});
  try{if(w.input_type!=="address")return res.status(400).json({error:"Live watch checks currently support contract addresses"});
    const current=await analyzeAddress(w.input_label,w.network);const baseline=JSON.parse(w.baseline_json);const diff=compareAnalyses(baseline,current);
    updateWatch(w.id,current);saveAnalysis(current,session(req));res.json({current,diff});
  }catch(e:any){res.status(400).json({error:e.message||"Watch check failed"});}
});
app.get("/api/admin/analytics",async(req,res)=>{
  const user=await admin(req);if(!user)return res.status(401).json({error:"Unauthorized"});
  res.json(analytics());
});
app.get("/api/admin/audit",async(req,res)=>{
  const user=await admin(req);if(!user)return res.status(401).json({error:"Unauthorized"});
  const rows=db.prepare("SELECT created_at,event,input_type,network,duration_ms,status,metadata_json FROM events ORDER BY created_at DESC LIMIT 500").all();
  res.json(rows);
});
app.listen(config.port,()=>console.log(`TDM API listening on http://localhost:${config.port}`));
