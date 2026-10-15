import React,{useEffect,useMemo,useState} from "react";
import { Search, GitBranch, Upload, ShieldCheck, Activity, History, GitCompareArrows, Eye, AlertTriangle, CheckCircle2, Network, RefreshCw, Radar, FileDiff, LogIn, FileText, Users, Building2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "./api";
import Graph from "./components/Graph";
import ReportPanel from "./components/ReportPanel";
import { Analysis } from "./types";

const sev=(s:string)=>s==="critical"?"sev-critical":s==="high"?"sev-high":s==="medium"?"sev-medium":"sev-low";

export default function App(){
 const [tab,setTab]=useState("analyze"),[mode,setMode]=useState<"address"|"github"|"zip">("address");
 const [address,setAddress]=useState(""),[network,setNetwork]=useState("ethereum"),[github,setGithub]=useState(""),[file,setFile]=useState<File|null>(null);
 const [analysis,setAnalysis]=useState<Analysis|null>(null),[history,setHistory]=useState<Analysis[]>([]),[selected,setSelected]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[compare,setCompare]=useState<any>(null),[blast,setBlast]=useState<any>(null);
 const [admin,setAdmin]=useState<any>(null),[audit,setAudit]=useState<any[]>([]),[loginOpen,setLoginOpen]=useState(false),[watch,setWatch]=useState<any[]>([]);
 const [historyError,setHistoryError]=useState(""),[compareError,setCompareError]=useState("");
 const [watchRuns,setWatchRuns]=useState<Record<number,any>>({}),[watchBusy,setWatchBusy]=useState<number|null>(null);\n const [accountEmail,setAccountEmail]=useState(""),[accountPassword,setAccountPassword]=useState(""),[accountToken,setAccountToken]=useState(sessionStorage.getItem("tdm_user_access")||"");\n const [organizations,setOrganizations]=useState<any[]>([]),[organizationId,setOrganizationId]=useState(sessionStorage.getItem("tdm_organization_id")||""),[organizationName,setOrganizationName]=useState(""),[memberEmail,setMemberEmail]=useState(""),[memberRole,setMemberRole]=useState<"admin"|"member">("member"),[members,setMembers]=useState<any[]>([]),[orgUsage,setOrgUsage]=useState<any>(null),[orgError,setOrgError]=useState("");

 const loadHistory = async () => {
  try {
    const response = await api<unknown>("/api/analyses?limit=100");

    const rows: any[] = Array.isArray(response)
      ? response
      : Array.isArray((response as any)?.analyses)
        ? (response as any).analyses
        : [];

    const safeRows = rows
      .filter((item: any) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string"
      )
      .map((item: any) => {
        const dependencies = Array.isArray(item.dependencies)
          ? item.dependencies
          : [];

        const findings = Array.isArray(item.findings)
          ? item.findings
          : [];

        const summary =
          item.summary && typeof item.summary === "object"
            ? item.summary
            : {};

        return {
          ...item,
          inputLabel:
            typeof item.inputLabel === "string"
              ? item.inputLabel
              : "Unnamed analysis",
          inputType:
            typeof item.inputType === "string"
              ? item.inputType
              : "unknown",
          createdAt: item.createdAt || new Date().toISOString(),
          summary: {
            ...summary,
            dependencyCount: Number.isFinite(Number(summary.dependencyCount))
              ? Number(summary.dependencyCount)
              : dependencies.length,
            critical: Number.isFinite(Number(summary.critical))
              ? Number(summary.critical)
              : findings.filter((f: any) => f?.severity === "critical").length,
            high: Number.isFinite(Number(summary.high))
              ? Number(summary.high)
              : findings.filter((f: any) => f?.severity === "high").length
          }
        };
      });

    setHistory(safeRows as Analysis[]);
    setHistoryError(
      !Array.isArray(response) && safeRows.length === 0
        ? "Unexpected history response from the API. Check the backend logs."
        : ""
    );
  } catch (e: any) {
    setHistory([]);
    setHistoryError(
      e?.message || "Could not load analysis history."
    );
  }
};
 const loadOrganizations=async()=>{
  if(!sessionStorage.getItem("tdm_user_access"))return;
  try{const rows=await api<any[]>("/api/organizations");setOrganizations(rows);
   const current=sessionStorage.getItem("tdm_organization_id")||"";
   if(current&&!rows.some(o=>o.id===current)){sessionStorage.removeItem("tdm_organization_id");setOrganizationId("");}
  }catch(e:any){setOrgError(e.message||"Could not load organizations");}
 };
 async function accountAction(action:"register"|"login"){
  setOrgError("");
  try{
   if(action==="register")await api("/api/accounts/register",{method:"POST",body:JSON.stringify({email:accountEmail,password:accountPassword})});
   const out=await api<any>("/api/accounts/login",{method:"POST",body:JSON.stringify({email:accountEmail,password:accountPassword})});
   sessionStorage.setItem("tdm_user_access",out.access);setAccountToken(out.access);await loadOrganizations();
  }catch(e:any){setOrgError(e.message||"Account action failed");}
 }
 async function createOrganizationNow(){
  try{const org=await api<any>("/api/organizations",{method:"POST",body:JSON.stringify({name:organizationName})});setOrganizationName("");await loadOrganizations();chooseOrganization(org.id);}
  catch(e:any){setOrgError(e.message||"Could not create organization");}
 }
 function chooseOrganization(id:string){
  if(id){sessionStorage.setItem("tdm_organization_id",id);setOrganizationId(id);}
  else{sessionStorage.removeItem("tdm_organization_id");setOrganizationId("");}
  setMembers([]);setOrgUsage(null);setHistoryError("");loadHistory();loadWatch();
 }
 async function loadOrgDetails(){
  if(!organizationId)return;
  try{const [m,u]=await Promise.all([api<any[]>("/api/organizations/members"),api<any>("/api/organizations/usage")]);setMembers(m);setOrgUsage(u);}
  catch(e:any){setOrgError(e.message||"Could not load organization details");}
 }
 async function addOrganizationMember(){
  try{await api("/api/organizations/members",{method:"POST",body:JSON.stringify({email:memberEmail,role:memberRole})});setMemberEmail("");await loadOrgDetails();}
  catch(e:any){setOrgError(e.message||"Could not add member");}
 }
 useEffect(()=>{loadOrganizations()},[]);
 useEffect(()=>{loadOrgDetails()},[organizationId,accountToken]);
 const loadWatch=async()=>{
  try{
    const rows=await api<any[]>("/api/watchlist");setWatch(rows);
    const statuses=await Promise.all(rows.map(async w=>{try{return [Number(w.id),await api<any>(`/api/watchlist/${w.id}/status`)] as const}catch{return [Number(w.id),null] as const}}));
    setWatchRuns(Object.fromEntries(statuses.filter(x=>x[1])));
  }catch{}
 };
 async function checkWatch(id:number){
  setWatchBusy(id);
  try{await api(`/api/watchlist/${id}/check`,{method:"POST"});await loadWatch()}
  catch(e:any){await loadWatch();setHistoryError(e?.message||"Watch check failed. See watch status for details.")}
  finally{setWatchBusy(null)}
 }
 useEffect(()=>{loadHistory();loadWatch()},[]);
 async function run(){
   setError("");

   if (mode === "address") {
     const value = address.trim();
     if (!value) {
       setError("Please enter a contract address before analyzing.");
       return;
     }
     if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
       setError("Enter a valid  Ethereum contract address (0x followed by 40 hexadecimal characters).");
       return;
     }
   }

   if (mode === "github") {
     const value = github.trim();
     if (!value) {
       setError("Please enter a GitHub repository URL.");
       return;
     }
     if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(value)) {
       setError("Enter a valid GitHub repository URL, such as https://github.com/owner/repository.");
       return;
     }
   }

   if (mode === "zip" && !file) {
     setError("Please choose a Solidity ZIP file before analyzing.");
     return;
   }

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
   setCompareError("");
   const b=(document.getElementById("before") as HTMLSelectElement)?.value,a=(document.getElementById("after") as HTMLSelectElement)?.value;
   if(!b || !a) { setCompareError("Run at least two analyses before comparing results."); return; }
   if(b===a) { setCompareError("Choose two different analyses to compare."); return; }
   try { setCompare(await api("/api/compare",{method:"POST",body:JSON.stringify({beforeId:b,afterId:a})})); }
   catch(e:any) { setCompareError(e?.message || "Comparison failed. Please retry."); }
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
 const nav: Array<[string,string,LucideIcon]> = [["analyze","Analyze",Search],["results","Results",ShieldCheck],["report","Security report",FileText],["history","History",History],["compare","Compare",GitCompareArrows],["organizations","Organizations",Building2]];
 return <div className="app">
  <header className="topbar"><div className="brand"><div className="logo">T</div><div><b>Trust Dependency Mapper</b><span>Blockchain trust & blast-radius intelligence</span></div></div><button className="admin-btn" onClick={loadAdmin}><Activity size={16}/> Admin analytics</button></header>
  <div className="layout"><aside>{nav.map(([id,label,I])=><button className={tab===id?"nav active":"nav"} onClick={()=>setTab(id)} key={id}><I size={17}/>{label}</button>)}<div className="side-note"><b>Security principle</b><p>Map trust assumptions, prove them with evidence, and inspect what becomes reachable if a dependency changes.</p></div></aside>
   <main>
    {tab==="analyze"&&<section className="hero"><div className="eyebrow">SECURITY INFRASTRUCTURE</div><h1>Know what your protocol <em>trusts.</em></h1><p>Discover privileged controls, proxies, oracles, bridges, external contracts and runtime call paths. Then inspect evidence and blast radius.</p>
     <div className="input-card"><div className="mode-row">{([ ["address","Contract address",Search], ["github","GitHub repository",GitBranch], ["zip","Upload Solidity ZIP",Upload] ] as Array<[string,string,LucideIcon]>).map(([m,l,I])=><button key={m} className={mode===m?"mode active":"mode"} onClick={()=>setMode(m as any)}><I size={16}/>{l}</button>)}</div>
      {mode==="address"&&<div className="fields"><input placeholder="0x contract address" value={address} onChange={e=>setAddress(e.target.value)}/><select value={network} onChange={e=>setNetwork(e.target.value)}>{["ethereum","sepolia","arbitrum","base"].map(n=><option key={n}>{n}</option>)}</select></div>}
      {mode==="github"&&<input placeholder="https://github.com/owner/repository" value={github} onChange={e=>setGithub(e.target.value)}/>}
      {mode==="zip"&&<label className="drop"><Upload size={25}/><span>{file?file.name:"Choose a .zip Solidity project"}</span><input type="file" accept=".zip" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>}
      {error&&<div className="error"><AlertTriangle size={16}/>{error}</div>}<button className="primary" onClick={run} disabled={busy}>{busy?<><RefreshCw className="spin" size={17}/>Analyzingâ€¦</>:<>Analyze trust surface <span>â†’</span></>}</button>
     </div>
     <div className="feature-grid">{([ ["Evidence-backed dependency map",ShieldCheck], ["Runtime trace signals",Radar], ["Upgrade/trust diff",FileDiff], ["Continuous watchlist",Eye] ] as Array<[string,LucideIcon]>).map(([x,I])=><div className="mini" key={x as string}><I size={16}/><span>{x as string}</span></div>)}</div>
    </section>}

    {tab==="results"&&!analysis&&<section className="page-empty"><div className="empty-state"><ShieldCheck size={34}/><h2>No analysis results yet</h2><p>Run a contract, GitHub repository, or ZIP analysis first. Your results will appear here.</p><button className="primary" onClick={()=>setTab("analyze")}>Go to Analyze <span>â†’</span></button></div></section>}
    {tab==="results"&&analysis&&<section><div className="section-head"><div><div className="eyebrow">ANALYSIS COMPLETE</div><h2>{analysis.inputLabel}</h2><p>{analysis.network||analysis.inputType} Â· {new Date(analysis.createdAt).toLocaleString()} Â· {analysis.durationMs} ms</p></div><div className="actions"><button onClick={saveWatch}><Eye size={15}/> Watch</button><button onClick={()=>setTab("report")}><FileText size={15}/> Security report</button><button onClick={()=>setTab("analyze")}>New analysis</button></div></div>
     <div className="stats"><Stat n={analysis.summary.dependencyCount} l="Dependencies"/><Stat n={analysis.summary.critical} l="Critical" bad/><Stat n={analysis.summary.high} l="High" bad/><Stat n={analysis.summary.privilegedControls} l="Privileged controls"/><Stat n={analysis.summary.upgradeable?"YES":"NO"} l="Upgradeable"/></div>
     <div className="result-grid"><div className="panel graph-panel"><div className="panel-title"><span>Trust dependency graph</span><small>Drag â€¢ zoom â€¢ click</small></div><Graph analysis={analysis} onSelect={selectDependency}/></div>
      <div className="panel inspector">{dep?<><div className="panel-title"><span>Dependency detail</span><button onClick={()=>setSelected(null)}>Ã—</button></div><h3>{dep.name}</h3><div className="tag-row"><span className={sev(dep.severity)}>{dep.severity}</span><span className="tag">{dep.type}</span><span className="tag">{Math.round(dep.confidence*100)}% confidence</span></div><h4>Capabilities</h4><ul>{dep.capabilities.map(x=><li key={x}>{x}</li>)}</ul><h4>Evidence</h4>{dep.evidence.map((e,i)=><div className="evidence" key={i}><b>{e.source}</b><span>{e.reason}</span>{e.function&&<code>{e.function}</code>}{e.value&&<code>{e.value}</code>}{e.file&&<code>{e.file}{e.line?`:${e.line}`:""}</code>}</div>)}{blast&&<><h4>Blast radius</h4><div className="blast"><strong>{blast.reachableNodes.length}</strong><span>reachable graph nodes</span><p>{blast.explanation}</p></div></>}</>:<div className="empty"><Network size={28}/><b>Select a node</b><span>Inspect evidence and the discovered blast radius.</span></div>}</div>
     </div>
     <div className="lower-grid"><div className="panel"><div className="panel-title">Findings <small>{analysis.findings.length}</small></div>{analysis.findings.length?analysis.findings.map(f=><div className="finding" key={f.id}><span className={sev(f.severity)}>{f.severity}</span><div><b>{f.title}</b><p>{f.description}</p><small>{Math.round(f.confidence*100)}% confidence Â· {f.evidence.map((e:any)=>e.source).join(", ")}</small></div></div>):<div className="empty compact"><CheckCircle2/><span>No heuristic findings from available evidence.</span></div>}</div>
      <div className="panel"><div className="panel-title">Analysis log <small>run trace</small></div><div className="logs">{analysis.logs.map((l,i)=><div key={i}><time>{new Date(l.ts).toLocaleTimeString()}</time><span className={`dot ${l.level}`}></span><span>{l.message}</span></div>)}</div></div></div>
     <div className="panel details"><div className="panel-title">Engine metadata <small>what the engine actually inspected</small></div><div className="meta-grid">{Object.entries(analysis.metadata||{}).map(([k,v])=><div key={k}><span>{k}</span><code>{typeof v==="object"?JSON.stringify(v):String(v)}</code></div>)}</div></div>
    </section>}

    {tab==="report"&&<ReportPanel analysis={analysis}/>}

    {tab==="history"&&<section><div className="section-head"><div><div className="eyebrow">HISTORY</div><h2>Previous analyses</h2><p>Server-side history for this anonymous browser session.</p></div></div>{historyError&&<div className="error page-error"><AlertTriangle size={16}/>{historyError}<button onClick={loadHistory}>Retry</button></div>}
     <div className="history-list">{history.map(a=><button key={a.id} onClick={()=>{setAnalysis(a);setTab("results")}}><div><b>{a.inputLabel}</b><span>{a.inputType} {a.network?`Â· ${a.network}`:""} Â· {new Date(a.createdAt).toLocaleString()}</span></div><div><strong>{a.summary.dependencyCount}</strong><span>dependencies</span></div><div><strong className="red">{a.summary.critical+a.summary.high}</strong><span>critical/high</span></div><span>â†’</span></button>)}</div>
     {!history.length&&!historyError&&<div className="empty-state inline-empty"><History size={28}/><h3>No saved analyses yet</h3><p>Complete an analysis and it will appear here for this browser session.</p><button className="primary" onClick={()=>setTab("analyze")}>Start an analysis</button></div>}<div className="panel watch-panel"><div className="panel-title">Watchlist <small>{watch.length}</small></div>{watch.length?watch.map(w=><div className="watch-row" key={w.id}><div><b>{w.name}</b><span>{w.network||w.input_type} · {watchRuns[Number(w.id)]?.status||"idle"}</span><small>{watchRuns[Number(w.id)]?.message||"Not checked yet"}</small>{watchRuns[Number(w.id)]?.error&&<small className="red">{watchRuns[Number(w.id)].error}</small>}</div><span>{w.last_check_at?new Date(w.last_check_at).toLocaleString():"No successful check"}</span><button disabled={watchBusy===Number(w.id)||w.input_type!=="address"} onClick={()=>checkWatch(Number(w.id))}>{watchBusy===Number(w.id)?"Checking…":"Check now"}</button><button onClick={async()=>{try{const rows=await api<any[]>(`/api/watchlist/${w.id}/snapshots?limit=5`);setWatchRuns(old=>({...old,[Number(w.id)]:{...old[Number(w.id)],snapshots:rows}}))}catch{}}}>Snapshots</button>{watchRuns[Number(w.id)]?.snapshots&&<><small>{watchRuns[Number(w.id)].snapshots.length} saved snapshots · {watchRuns[Number(w.id)].snapshots[0]?.captured_at?new Date(watchRuns[Number(w.id)].snapshots[0].captured_at).toLocaleString():""}</small>{watchRuns[Number(w.id)].snapshots[0]?.diff?.summary&&<small>Latest diff: +{watchRuns[Number(w.id)].snapshots[0].diff.summary.added} added · −{watchRuns[Number(w.id)].snapshots[0].diff.summary.removed} removed · {watchRuns[Number(w.id)].snapshots[0].diff.summary.changed} changed</small>}</>}</div>):<div className="empty compact">Save an address analysis with Watch to track trust changes.</div>}</div></section>}

    {tab==="organizations"&&<section><div className="section-head"><div><div className="eyebrow">TEAM WORKSPACE</div><h2>Organizations & plans</h2><p>Free workspaces include 10 analyses per month. Team plan limits are enforced server-side; paid upgrades require a configured billing provider.</p></div></div>
     {!accountToken?<div className="panel org-panel"><h3>Create an account or sign in</h3><p>Accounts use email and password. Use at least 10 characters for a new password.</p><div className="org-form"><input placeholder="Email address" type="email" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)}/><input placeholder="Password (10+ characters)" type="password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)}/><button onClick={()=>accountAction("register")}>Register & sign in</button><button className="primary" onClick={()=>accountAction("login")}>Sign in</button></div></div>
     :<><div className="panel org-panel"><div className="panel-title">Workspace selector</div><div className="org-form"><select value={organizationId} onChange={e=>chooseOrganization(e.target.value)}><option value="">Personal / public mode</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}</select><input placeholder="New organization name" value={organizationName} onChange={e=>setOrganizationName(e.target.value)}/><button className="primary" onClick={createOrganizationNow} disabled={organizationName.trim().length<2}>Create organization</button><button onClick={()=>{sessionStorage.removeItem("tdm_user_access");sessionStorage.removeItem("tdm_organization_id");setAccountToken("");setOrganizationId("");setOrganizations([]);}}>Sign out</button></div></div>
     {organizationId&&<><div className="stats">{orgUsage&&<><Stat n={orgUsage.plan} l="Current plan"/><Stat n={orgUsage.subscriptionStatus} l="Subscription state"/><Stat n={`${orgUsage.analyses}/${orgUsage.limit}`} l="Analyses this month"/></>}</div><div className="panel org-panel"><div className="panel-title">Members & roles <small>{members.length}</small></div><div className="org-form"><input placeholder="Existing account email" type="email" value={memberEmail} onChange={e=>setMemberEmail(e.target.value)}/><select value={memberRole} onChange={e=>setMemberRole(e.target.value as "admin"|"member")}><option value="member">Member</option><option value="admin">Admin</option></select><button onClick={addOrganizationMember} disabled={!memberEmail.includes("@")}>Add member</button></div>{members.map(m=><div className="org-member" key={m.id}><span>{m.email}</span><b>{m.role}</b></div>)}</div></>}
     </>}
     {orgError&&<div className="error page-error"><AlertTriangle size={16}/>{orgError}</div>}
    </section>}
    {tab==="compare"&&<section><div className="section-head"><div><div className="eyebrow">TRUST DIFF</div><h2>Compare two analyses</h2><p>Compare dependency identity, severity, confidence and capabilities.</p></div></div>{history.length>=2?<div className="compare-picker"><select id="before" defaultValue={history[0]?.id}>{history.map(a=><option value={a.id} key={a.id}>{a.inputLabel} Â· {new Date(a.createdAt).toLocaleString()}</option>)}</select><span>â†’</span><select id="after" defaultValue={history[1]?.id}>{history.map(a=><option value={a.id} key={a.id}>{a.inputLabel} Â· {new Date(a.createdAt).toLocaleString()}</option>)}</select><button className="primary" onClick={compareNow}>Compare</button></div>:<div className="empty-state inline-empty"><GitCompareArrows size={28}/><h3>Two analyses are required</h3><p>Analyze a contract or repository twice (or analyze two different targets) to compare dependency changes.</p><button className="primary" onClick={()=>setTab("analyze")}>Start an analysis</button></div>}
     {compareError&&<div className="error page-error"><AlertTriangle size={16}/>{compareError}</div>}{compare&&<div className="panel compare"><div className="stats"><Stat n={compare.summary.added} l="Added"/><Stat n={compare.summary.removed} l="Removed"/><Stat n={compare.summary.changed} l="Changed"/><Stat n={compare.summary.riskDelta>0?`+${compare.summary.riskDelta}`:compare.summary.riskDelta} l="Severity-weight delta" bad={compare.summary.riskDelta>0}/></div><CompareSection title="Added" items={compare.added}/><CompareSection title="Removed" items={compare.removed}/>{compare.changed.map((x:any)=><div className="diffrow" key={x.after.id}><span className="tag">CHANGED</span><b>{x.after.name}</b><span>{x.before.severity} â†’ {x.after.severity}</span></div>)}</div>}</section>}

    {tab==="admin"&&admin&&<section><div className="section-head"><div><div className="eyebrow">PRIVATE ADMIN</div><h2>Product analytics</h2><p>Authenticated operational dashboard. User identity is anonymous to this layer.</p></div></div><div className="stats"><Stat n={admin.uniqueUsers} l="Unique anonymous users"/><Stat n={admin.totalAnalyses} l="Total analyses"/><Stat n={admin.last24h} l="Analyses / 24h"/><Stat n={admin.last7d} l="Analyses / 7d"/><Stat n={`${admin.avgDurationMs}ms`} l="Avg analysis time"/></div><div className="panel analytics"><h3>Usage by input</h3>{admin.byInput.map((x:any)=><Bar key={x.type} label={x.type} count={x.count} total={admin.totalAnalyses}/>)}<h3>Usage by network</h3>{admin.byNetwork.map((x:any)=><Bar key={x.network} label={x.network} count={x.count} total={admin.totalAnalyses}/>)}</div><div className="panel"><div className="panel-title">Admin audit events <small>latest 500</small></div><div className="logs">{audit.map((x,i)=><div key={i}><time>{new Date(x.created_at).toLocaleString()}</time><span className="dot info"></span><span>{x.event} Â· {x.input_type||""} {x.network||""}</span></div>)}</div></div></section>}
   </main>
  </div>
  {loginOpen&&<LoginModal onLogin={login} onClose={()=>setLoginOpen(false)}/>}
 </div>
}
function Stat({n,l,bad}:{n:any;l:string;bad?:boolean}){return <div className="stat"><strong className={bad?"red":""}>{n}</strong><span>{l}</span></div>}
function CompareSection({title,items}:{title:string;items:any[]}){return <div className="diff-section"><h3>{title} <small>{items.length}</small></h3>{items.map(x=><div className="diffrow" key={x.id}><span className={sev(x.severity)}>{x.severity}</span><b>{x.name}</b><span>{x.type}</span></div>)}</div>}
function Bar({label,count,total}:{label:string;count:number;total:number}){return <div className="barrow"><span>{label}</span><div><i style={{width:`${total?Math.min(100,count/total*100):0}%`}}/></div><b>{count}</b></div>}
function LoginModal({onLogin,onClose}:{onLogin:(u:string,p:string)=>void;onClose:()=>void}){const[u,setU]=useState(""),[p,setP]=useState(""),[busy,setBusy]=useState(false),[e,setE]=useState("");return <div className="modal-bg"><div className="modal"><div className="eyebrow">ADMIN ACCESS</div><h2>Sign in</h2><p>Private product analytics and audit logs.</p><input placeholder="Username" value={u} onChange={x=>setU(x.target.value)}/><input placeholder="Password" type="password" value={p} onChange={x=>setP(x.target.value)}/>{e&&<div className="error">{e}</div>}<div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await onLogin(u,p)}catch(e:any){setE(e.message)}finally{setBusy(false)}}}><LogIn size={15}/>Sign in</button></div></div></div>}


