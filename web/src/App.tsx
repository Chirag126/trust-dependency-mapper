import React,{useEffect,useMemo,useState} from "react";
import { Search, GitBranch, Upload, ShieldCheck, Activity, History, GitCompareArrows, Eye, AlertTriangle, CheckCircle2, Network, RefreshCw, Radar, FileDiff, LogIn } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "./api";
import Graph from "./components/Graph";
import { Analysis } from "./types";

const sev=(s:string)=>s==="critical"?"sev-critical":s==="high"?"sev-high":s==="medium"?"sev-medium":"sev-low";

export default function App(){
 const [tab,setTab]=useState("analyze"),[mode,setMode]=useState<"address"|"github"|"zip">("address");
 const [address,setAddress]=useState(""),[network,setNetwork]=useState("ethereum"),[github,setGithub]=useState(""),[file,setFile]=useState<File|null>(null);
 const [analysis,setAnalysis]=useState<Analysis|null>(null),[history,setHistory]=useState<Analysis[]>([]),[selected,setSelected]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[compare,setCompare]=useState<any>(null),[blast,setBlast]=useState<any>(null);
 const [admin,setAdmin]=useState<any>(null),[audit,setAudit]=useState<any[]>([]),[loginOpen,setLoginOpen]=useState(false),[watch,setWatch]=useState<any[]>([]);

 const loadHistory=async()=>{try{setHistory(await api<Analysis[]>("/api/analyses?limit=100"))}catch{}};
 const loadWatch=async()=>{try{setWatch(await api<any[]>("/api/watchlist"))}catch{}};
 useEffect(()=>{loadHistory();loadWatch()},[]);
 async function run(){
   setBusy(true);setError("");setSelected(null);setBlast(null);
   try{
    let a:Analysis;
    if(mode==="address")a=await api<Analysis>("/api/analyze/address",{method:"POST",body:JSON.stringify({address,network})});
    else if(mode==="github")a=await api<Analysis>("/api/analyze/github",{method:"POST",body:JSON.stringify({url:github})});
    else{if(!file)throw new Error("Choose a ZIP file");const fd=new FormData();fd.append("project",file);a=await api<Analysis>("/api/analyze/zip",{method:"POST",body:fd})}
    setAnalysis(a);setTab("results");await loadHistory();
   }catch(e:any){setError(e.message)}
   finally{setBusy(false)}
 }
 async function selectDependency(id:string){
   setSelected(id);setBlast(null);
   if(!analysis)return;
   try{setBlast(await api(`/api/analyses/${analysis.id}/blast-radius/${id}`))}catch{}
 }
 async function saveWatch(){if(!analysis)return;await api("/api/watchlist",{method:"POST",body:JSON.stringify({name:analysis.inputLabel,analysisId:analysis.id})});await loadWatch()}
 async function compareNow(){
   const b=(document.getElementById("before") as HTMLSelectElement)?.value,a=(document.getElementById("after") as HTMLSelectElement)?.value;
   if(b&&a)setCompare(await api("/api/compare",{method:"POST",body:JSON.stringify({beforeId:b,afterId:a})}));
 }
 async function login(u:string,p:string){
   const out=await api<any>("/api/auth/login",{method:"POST",body:JSON.stringify({username:u,password:p})});
   sessionStorage.setItem("tdm_admin_access",out.access);sessionStorage.setItem("tdm_admin_refresh",out.refresh);setLoginOpen(false);await loadAdmin();
 }
 async function loadAdmin(){
   let token=sessionStorage.getItem("tdm_admin_access");
   if(!token){setLoginOpen(true);return}
   try{
    setAdmin(await api("/api/admin/analytics",{headers:{"Authorization":`Bearer ${token}`}}));
    setAudit(await api<any[]>("/api/admin/audit",{headers:{"Authorization":`Bearer ${token}`}}));setTab("admin");
   }catch{sessionStorage.removeItem("tdm_admin_access");setLoginOpen(true)}
 }
 const dep=analysis?.dependencies.find(d=>d.id===selected);
 const nav: Array<[string,string,LucideIcon]> = [["analyze","Analyze",Search],["results","Results",ShieldCheck],["history","History",History],["compare","Compare",GitCompareArrows]];
 return <div className="app">
  <header className="topbar"><div className="brand"><div className="logo">T</div><div><b>Trust Dependency Mapper</b><span>Blockchain trust & blast-radius intelligence</span></div></div><button className="admin-btn" onClick={loadAdmin}><Activity size={16}/> Admin analytics</button></header>
  <div className="layout"><aside>{nav.map(([id,label,I])=><button className={tab===id?"nav active":"nav"} onClick={()=>setTab(id)} key={id}><I size={17}/>{label}</button>)}<div className="side-note"><b>Security principle</b><p>Map trust assumptions, prove them with evidence, and inspect what becomes reachable if a dependency changes.</p></div></aside>
   <main>
    {tab==="analyze"&&<section className="hero"><div className="eyebrow">SECURITY INFRASTRUCTURE</div><h1>Know what your protocol <em>trusts.</em></h1><p>Discover privileged controls, proxies, oracles, bridges, external contracts and runtime call paths. Then inspect evidence and blast radius.</p>
     <div className="input-card"><div className="mode-row">{([ ["address","Contract address",Search], ["github","GitHub repository",GitBranch], ["zip","Upload Solidity ZIP",Upload] ] as Array<[string,string,LucideIcon]>).map(([m,l,I])=><button key={m} className={mode===m?"mode active":"mode"} onClick={()=>setMode(m as any)}><I size={16}/>{l}</button>)}</div>
      {mode==="address"&&<div className="fields"><input placeholder="0x contract address" value={address} onChange={e=>setAddress(e.target.value)}/><select value={network} onChange={e=>setNetwork(e.target.value)}>{["ethereum","sepolia","arbitrum","base"].map(n=><option key={n}>{n}</option>)}</select></div>}
      {mode==="github"&&<input placeholder="https://github.com/owner/repository" value={github} onChange={e=>setGithub(e.target.value)}/>}
      {mode==="zip"&&<label className="drop"><Upload size={25}/><span>{file?file.name:"Choose a .zip Solidity project"}</span><input type="file" accept=".zip" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>}
      {error&&<div className="error"><AlertTriangle size={16}/>{error}</div>}<button className="primary" onClick={run} disabled={busy}>{busy?<><RefreshCw className="spin" size={17}/>Analyzing…</>:<>Analyze trust surface <span>→</span></>}</button>
     </div>
     <div className="feature-grid">{([ ["Evidence-backed dependency map",ShieldCheck], ["Runtime trace signals",Radar], ["Upgrade/trust diff",FileDiff], ["Continuous watchlist",Eye] ] as Array<[string,LucideIcon]>).map(([x,I])=><div className="mini" key={x as string}><I size={16}/><span>{x as string}</span></div>)}</div>
    </section>}

    {tab==="results"&&analysis&&<section><div className="section-head"><div><div className="eyebrow">ANALYSIS COMPLETE</div><h2>{analysis.inputLabel}</h2><p>{analysis.network||analysis.inputType} · {new Date(analysis.createdAt).toLocaleString()} · {analysis.durationMs} ms</p></div><div className="actions"><button onClick={saveWatch}><Eye size={15}/> Watch</button><button onClick={()=>setTab("analyze")}>New analysis</button></div></div>
     <div className="stats"><Stat n={analysis.summary.dependencyCount} l="Dependencies"/><Stat n={analysis.summary.critical} l="Critical" bad/><Stat n={analysis.summary.high} l="High" bad/><Stat n={analysis.summary.privilegedControls} l="Privileged controls"/><Stat n={analysis.summary.upgradeable?"YES":"NO"} l="Upgradeable"/></div>
     <div className="result-grid"><div className="panel graph-panel"><div className="panel-title"><span>Trust dependency graph</span><small>Drag • zoom • click</small></div><Graph analysis={analysis} onSelect={selectDependency}/></div>
      <div className="panel inspector">{dep?<><div className="panel-title"><span>Dependency detail</span><button onClick={()=>setSelected(null)}>×</button></div><h3>{dep.name}</h3><div className="tag-row"><span className={sev(dep.severity)}>{dep.severity}</span><span className="tag">{dep.type}</span><span className="tag">{Math.round(dep.confidence*100)}% confidence</span></div><h4>Capabilities</h4><ul>{dep.capabilities.map(x=><li key={x}>{x}</li>)}</ul><h4>Evidence</h4>{dep.evidence.map((e,i)=><div className="evidence" key={i}><b>{e.source}</b><span>{e.reason}</span>{e.function&&<code>{e.function}</code>}{e.value&&<code>{e.value}</code>}{e.file&&<code>{e.file}{e.line?`:${e.line}`:""}</code>}</div>)}{blast&&<><h4>Blast radius</h4><div className="blast"><strong>{blast.reachableNodes.length}</strong><span>reachable graph nodes</span><p>{blast.explanation}</p></div></>}</>:<div className="empty"><Network size={28}/><b>Select a node</b><span>Inspect evidence and the discovered blast radius.</span></div>}</div>
     </div>
     <div className="lower-grid"><div className="panel"><div className="panel-title">Findings <small>{analysis.findings.length}</small></div>{analysis.findings.length?analysis.findings.map(f=><div className="finding" key={f.id}><span className={sev(f.severity)}>{f.severity}</span><div><b>{f.title}</b><p>{f.description}</p><small>{Math.round(f.confidence*100)}% confidence · {f.evidence.map((e:any)=>e.source).join(", ")}</small></div></div>):<div className="empty compact"><CheckCircle2/><span>No heuristic findings from available evidence.</span></div>}</div>
      <div className="panel"><div className="panel-title">Analysis log <small>run trace</small></div><div className="logs">{analysis.logs.map((l,i)=><div key={i}><time>{new Date(l.ts).toLocaleTimeString()}</time><span className={`dot ${l.level}`}></span><span>{l.message}</span></div>)}</div></div></div>
     <div className="panel details"><div className="panel-title">Engine metadata <small>what the engine actually inspected</small></div><div className="meta-grid">{Object.entries(analysis.metadata||{}).map(([k,v])=><div key={k}><span>{k}</span><code>{typeof v==="object"?JSON.stringify(v):String(v)}</code></div>)}</div></div>
    </section>}

    {tab==="history"&&<section><div className="section-head"><div><div className="eyebrow">HISTORY</div><h2>Previous analyses</h2><p>Server-side history for this anonymous browser session.</p></div></div><div className="history-list">{history.map(a=><button key={a.id} onClick={()=>{setAnalysis(a);setTab("results")}}><div><b>{a.inputLabel}</b><span>{a.inputType} {a.network?`· ${a.network}`:""} · {new Date(a.createdAt).toLocaleString()}</span></div><div><strong>{a.summary.dependencyCount}</strong><span>dependencies</span></div><div><strong className="red">{a.summary.critical+a.summary.high}</strong><span>critical/high</span></div><span>→</span></button>)}</div><div className="panel watch-panel"><div className="panel-title">Watchlist <small>{watch.length}</small></div>{watch.length?watch.map(w=><div className="watch-row" key={w.id}><b>{w.name}</b><span>{w.network||w.input_type}</span><span>{w.last_check_at?new Date(w.last_check_at).toLocaleString():"Not checked yet"}</span></div>):<div className="empty compact">Save an address analysis with Watch to track trust changes.</div>}</div></section>}

    {tab==="compare"&&<section><div className="section-head"><div><div className="eyebrow">TRUST DIFF</div><h2>Compare two analyses</h2><p>Compare dependency identity, severity, confidence and capabilities.</p></div></div><div className="compare-picker"><select id="before">{history.map(a=><option value={a.id} key={a.id}>{a.inputLabel} · {new Date(a.createdAt).toLocaleString()}</option>)}</select><span>→</span><select id="after">{history.map(a=><option value={a.id} key={a.id}>{a.inputLabel} · {new Date(a.createdAt).toLocaleString()}</option>)}</select><button className="primary" onClick={compareNow}>Compare</button></div>{compare&&<div className="panel compare"><div className="stats"><Stat n={compare.summary.added} l="Added"/><Stat n={compare.summary.removed} l="Removed"/><Stat n={compare.summary.changed} l="Changed"/><Stat n={compare.summary.riskDelta>0?`+${compare.summary.riskDelta}`:compare.summary.riskDelta} l="Severity-weight delta" bad={compare.summary.riskDelta>0}/></div><CompareSection title="Added" items={compare.added}/><CompareSection title="Removed" items={compare.removed}/>{compare.changed.map((x:any)=><div className="diffrow" key={x.after.id}><span className="tag">CHANGED</span><b>{x.after.name}</b><span>{x.before.severity} → {x.after.severity}</span></div>)}</div>}</section>}

    {tab==="admin"&&admin&&<section><div className="section-head"><div><div className="eyebrow">PRIVATE ADMIN</div><h2>Product analytics</h2><p>Authenticated operational dashboard. User identity is anonymous to this layer.</p></div></div><div className="stats"><Stat n={admin.uniqueUsers} l="Unique anonymous users"/><Stat n={admin.totalAnalyses} l="Total analyses"/><Stat n={admin.last24h} l="Analyses / 24h"/><Stat n={admin.last7d} l="Analyses / 7d"/><Stat n={`${admin.avgDurationMs}ms`} l="Avg analysis time"/></div><div className="panel analytics"><h3>Usage by input</h3>{admin.byInput.map((x:any)=><Bar key={x.type} label={x.type} count={x.count} total={admin.totalAnalyses}/>)}<h3>Usage by network</h3>{admin.byNetwork.map((x:any)=><Bar key={x.network} label={x.network} count={x.count} total={admin.totalAnalyses}/>)}</div><div className="panel"><div className="panel-title">Admin audit events <small>latest 500</small></div><div className="logs">{audit.map((x,i)=><div key={i}><time>{new Date(x.created_at).toLocaleString()}</time><span className="dot info"></span><span>{x.event} · {x.input_type||""} {x.network||""}</span></div>)}</div></div></section>}
   </main>
  </div>
  {loginOpen&&<LoginModal onLogin={login} onClose={()=>setLoginOpen(false)}/>}
 </div>
}
function Stat({n,l,bad}:{n:any;l:string;bad?:boolean}){return <div className="stat"><strong className={bad?"red":""}>{n}</strong><span>{l}</span></div>}
function CompareSection({title,items}:{title:string;items:any[]}){return <div className="diff-section"><h3>{title} <small>{items.length}</small></h3>{items.map(x=><div className="diffrow" key={x.id}><span className={sev(x.severity)}>{x.severity}</span><b>{x.name}</b><span>{x.type}</span></div>)}</div>}
function Bar({label,count,total}:{label:string;count:number;total:number}){return <div className="barrow"><span>{label}</span><div><i style={{width:`${total?Math.min(100,count/total*100):0}%`}}/></div><b>{count}</b></div>}
function LoginModal({onLogin,onClose}:{onLogin:(u:string,p:string)=>void;onClose:()=>void}){const[u,setU]=useState(""),[p,setP]=useState(""),[busy,setBusy]=useState(false),[e,setE]=useState("");return <div className="modal-bg"><div className="modal"><div className="eyebrow">ADMIN ACCESS</div><h2>Sign in</h2><p>Private product analytics and audit logs.</p><input placeholder="Username" value={u} onChange={x=>setU(x.target.value)}/><input placeholder="Password" type="password" value={p} onChange={x=>setP(x.target.value)}/>{e&&<div className="error">{e}</div>}<div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onLogin(u,p)}catch(e:any){setE(e.message)}finally{setBusy(false)}}}><LogIn size={15}/>Sign in</button></div></div></div>}
