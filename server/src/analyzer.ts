import { ethers } from "ethers";
import solc from "solc";
import { Analysis, Dependency, Evidence, Severity, GraphNode, GraphEdge } from "./types";
import { id, now, severityRank } from "./utils";
import { getContractContext, Network, traceCall, collectTraceAddresses } from "./chain";
import { readProxySlots, probeProxy, readAccessControl, githubRepoFiles } from "./source";

const ORACLE_NAMES=/oracle|aggregator|pricefeed|price.?feed|chainlink|pyth|redstone|tellor/i;
const BRIDGE_NAMES=/bridge|messenger|crosschain|layerzero|wormhole|ccip|optimismportal|arbiter/i;
const ADMIN_NAMES=/owner|admin|operator|guardian|governor|multisig|pauser|upgrade/i;

function log(logs:any[],level:any,message:string){logs.push({ts:now(),level,message});}
function dep(name:string,type:any,severity:Severity,confidence:number,caps:string[],evidence:Evidence[],address?:string):Dependency{
  return {id:id("dep"),name,type,severity,confidence,capabilities:caps,evidence,address};
}
function dedupe(ds:Dependency[]){
  const map=new Map<string,Dependency>();
  for(const d of ds){
    const key=`${d.type}|${(d.address||d.name).toLowerCase()}`;
    const old=map.get(key);
    if(!old)map.set(key,d);
    else{
      if(severityRank(d.severity)>severityRank(old.severity))old.severity=d.severity;
      old.confidence=Math.max(old.confidence,d.confidence);
      old.capabilities=[...new Set([...old.capabilities,...d.capabilities])];
      old.evidence.push(...d.evidence);
    }
  }
  return [...map.values()];
}
function graph(root:string,ds:Dependency[],links:{from:string;to:string;relation:string;evidence?:Evidence[]}[]=[]){
  const nodes:GraphNode[]=[{id:"root",label:root,kind:"root"}]; const edges:GraphEdge[]=[];
  const validIds=new Set<string>(["root"]);
  for(const d of ds){nodes.push({id:d.id,label:d.name,kind:"dependency",dependencyId:d.id,severity:d.severity});validIds.add(d.id);}
  for(const d of ds)edges.push({source:"root",target:d.id,relation:d.type,evidence:d.evidence});
  for(const l of links){
    if(validIds.has(l.from)&&validIds.has(l.to))edges.push({source:l.from,target:l.to,relation:l.relation,evidence:l.evidence});
  }
  return {nodes,edges};
}

type SourceFile = {path:string;content:string};
type SourceContract = {file:string;name:string;kind:"contract"|"interface"|"library"|"abstract";bases:string[];imports:string[];abi:any[];bytecode:string;storageLayout?:any};

const SOLIDITY_PRAGMA=/pragma\s+solidity\s+([^;]+);/g;
const IMPORT_RE=/import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/g;
const DECL_RE=/(abstract\s+)?(contract|interface|library)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+is\s+([^\{]+))?\s*\{/g;

function lineOf(text:string,index:number){return text.slice(0,index).split("\n").length;}
function normalizePath(p:string){return p.replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/\.\//g,"/");}
function resolveImport(importer:string,requested:string,files:SourceFile[]){
  const clean=normalizePath(requested);
  const importerDir=normalizePath(importer).split("/").slice(0,-1).join("/");
  const relative=normalizePath(`${importerDir}/${clean}`);
  const candidates=[clean,relative,clean.replace(/^\//,"")];
  for(const c of candidates){const exact=files.find(f=>normalizePath(f.path)===c);if(exact)return exact;}
  const suffix=files.find(f=>normalizePath(f.path).endsWith(`/${clean}`));
  return suffix;
}

function pragmaVersions(files:SourceFile[]){
  const versions:string[]=[];
  for(const f of files)if(/\.sol$/i.test(f.path)){
    for(const m of f.content.matchAll(SOLIDITY_PRAGMA))versions.push(m[1].trim());
  }
  return [...new Set(versions)];
}

async function compilerForPragmas(pragmas:string[],logs:any[]){
  const current=solc.version();
  const currentMatch=current.match(/^(\d+\.\d+\.\d+)/);
  const currentVersion=currentMatch?.[1]||"0.8.30";
  const compatible=(constraint:string,version:string)=>{
    if(/^=\s*\d+\.\d+\.\d+$/.test(constraint))return constraint.replace(/^=\s*/,"")===version;
    const majorMinor=constraint.match(/^(?:\^|~|>=|>)?\s*(\d+\.\d+)/)?.[1];
    return majorMinor?version.startsWith(majorMinor):true;
  };
  if(pragmas.every(p=>compatible(p,currentVersion)))return {compiler:solc,version:currentVersion};
  const exact=pragmas.map(p=>p.match(/(?:^|\s|[<>=^~])([0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)/)?.[1]).find(Boolean);
  if(!exact){log(logs,"warn",`Detected Solidity pragmas (${pragmas.join(", ")}) that are not directly compatible with bundled solc ${currentVersion}; using source analysis without compiler-specific assumptions.`);return {compiler:null,version:null};}
  try{
    const listRes=await fetch("https://binaries.soliditylang.org/bin/list.json");
    if(!listRes.ok)throw new Error(`compiler index HTTP ${listRes.status}`);
    const list:any=await listRes.json();
    const build=list.releases?.[exact];
    if(!build)throw new Error(`no official solc build for ${exact}`);
    const remote:any=await new Promise((resolve,reject)=>solc.loadRemoteVersion(build,(err:any,loaded:any)=>err?reject(err):resolve(loaded)));
    log(logs,"info",`Using Solidity compiler ${exact} selected from repository pragma.`);
    return {compiler:remote,version:exact};
  }catch(error){
    log(logs,"warn",`Could not load Solidity compiler ${exact}; continuing with source-level dependency extraction.`);
    return {compiler:null,version:null};
  }
}

function parseSourceContracts(files:SourceFile[]){
  const contracts:SourceContract[]=[];
  for(const f of files){
    if(!/\.sol$/i.test(f.path))continue;
    const imports=[...f.content.matchAll(IMPORT_RE)].map(m=>m[1]);
    for(const m of f.content.matchAll(DECL_RE)){
      const kind=(m[2]==="interface"?"interface":m[2]==="library"?"library":m[1]?"abstract":"contract") as SourceContract["kind"];
      const bases=(m[4]||"").split(",").map(x=>x.trim().split(/\s+/)[0]).filter(Boolean);
      contracts.push({file:f.path,name:m[3],kind,bases,imports,abi:[],bytecode:""});
    }
  }
  return contracts;
}

function sourceEvidence(file:string,text:string,index:number,reason:string,value?:string):Evidence{
  return {file,line:lineOf(text,index),reason,source:"source",...(value?{value}:{})};
}

function sourceDependencies(files:SourceFile[],contracts:SourceContract[],logs:any[],deps:Dependency[],links:any[],findings:any[]){
  const contractByName=new Map(contracts.map(c=>[c.name,c]));
  const depForComponent=new Map<string,Dependency>();
  const ensureComponent=(name:string,file:string,text:string,index:number,reason:string)=>{
    const key=`component:${name}`;
    let d=depForComponent.get(key);
    if(!d){
      d=dep(`Source component ${name}`,"external-contract","low",0.95,["source dependency"],[sourceEvidence(file,text,index,reason,name)]);
      depForComponent.set(key,d); deps.push(d);
    }
    return d;
  };
  for(const f of files){
    if(!/\.sol$/i.test(f.path))continue;
    for(const m of f.content.matchAll(IMPORT_RE)){
      const requested=m[1],target=resolveImport(f.path,requested,files);
      const evidence=sourceEvidence(f.path,f.content,m.index??0,`Solidity import dependency: ${requested}`,requested);
      if(target){
        const names=contracts.filter(c=>c.file===target.path).map(c=>c.name);
        const d=ensureComponent(names[0]||target.path,target.path,target.content,0,`Imported source file ${requested}`);
        d.evidence.push(evidence);
        links.push({from:"root",to:d.id,relation:"imports",evidence:[evidence]});
      }else{
        const d=dep(`Imported package ${requested}`,"external-contract","medium",0.82,["source/package dependency"],[evidence]);
        deps.push(d);links.push({from:"root",to:d.id,relation:"imports",evidence:[evidence]});
      }
    }
    for(const m of f.content.matchAll(DECL_RE)){
      const contractName=m[3], bases=(m[4]||"").split(",").map(x=>x.trim().split(/\s+/)[0]).filter(Boolean);
      for(const base of bases){
        const baseContract=contractByName.get(base);
        const d=baseContract?ensureComponent(base,baseContract.file,files.find(x=>x.path===baseContract.file)?.content||"",0,`Inheritance from ${base}`):dep(`Inherited type ${base}`,"external-contract","low",0.88,["inheritance dependency"],[sourceEvidence(f.path,f.content,m.index??0,`Contract ${contractName} inherits from ${base}`,base)]);
        if(!baseContract)deps.push(d);
        links.push({from:"root",to:d.id,relation:`inherits (${contractName})`});
      }
    }
  }

  const addPattern=(rx:RegExp,title:string,type:Dependency["type"],severity:Severity,capability:string,confidence:number,reason:string)=>{
    for(const f of files){if(!/\.sol$/i.test(f.path))continue;const m=f.content.match(rx);if(!m)continue;const e=sourceEvidence(f.path,f.content,m.index??0,reason);
      deps.push(dep(title,type,severity,confidence,[capability],[e]));
    }
  };
  addPattern(/\b(?:AggregatorV3Interface|latestRoundData\s*\(|Chainlink|\bAggregator\b)/i,"Chainlink-style oracle","oracle","high","price/data dependency",0.95,"Chainlink AggregatorV3/latestRoundData pattern detected.");
  addPattern(/\b(?:IPyth|Pyth|getPriceUnsafe\s*\(|getPriceNoOlderThan\s*\()/i,"Pyth oracle candidate","oracle","high","price/data dependency",0.93,"Pyth interface/function pattern detected.");
  addPattern(/\b(?:RedStone|getOracleNumericValueFromTxMsg\s*\()/i,"RedStone oracle candidate","oracle","high","price/data dependency",0.92,"RedStone oracle pattern detected.");
  addPattern(/\b(?:Tellor|getCurrentValue\s*\(|getDataBefore\s*\()/i,"Tellor oracle candidate","oracle","high","price/data dependency",0.9,"Tellor oracle pattern detected.");
  addPattern(/\b(?:IUniswapV3Pool|observe\s*\(|OracleLibrary|consult\s*\()/i,"Uniswap V3 TWAP/oracle dependency","oracle","high","on-chain price observation",0.9,"Uniswap V3 pool observation/oracle pattern detected.");
  addPattern(/\b(?:LayerZero|ILayerZero|Wormhole|IWormhole|CCIP|IAny2EVMMessage|CrossDomainMessenger|OptimismPortal|Arbitrum|IBridge|bridge\s*\()/i,"Cross-chain messaging/bridge dependency","bridge","high","cross-chain dependency",0.9,"Cross-chain bridge or messaging interface pattern detected.");
  addPattern(/\b(?:IERC1967|ERC1967Upgrade|UUPSUpgradeable|TransparentUpgradeableProxy|BeaconProxy|UpgradeableBeacon|proxiableUUID\s*\()/i,"Upgradeable proxy framework","proxy","high","change implementation",0.92,"EIP-1967/ERC-1822 upgrade framework pattern detected.");
  addPattern(/\b(?:IDiamondCut|diamondCut\s*\(|facetAddress\s*\(|facetFunctionSelectors\s*\(|facets\s*\()/i,"EIP-2535 Diamond upgrade surface","proxy","critical","change facets/implementation",0.94,"Diamond facet management pattern detected.");

  for(const f of files){
    if(!/\.sol$/i.test(f.path))continue;
    for(const m of f.content.matchAll(/bytes32\s+(?:public\s+)?constant\s+([A-Za-z_][A-Za-z0-9_]*_ROLE)\s*=\s*keccak256\s*\(\s*["']([^"']+)["']\s*\)/g)){
      const e=sourceEvidence(f.path,f.content,m.index??0,`Role identifier ${m[1]} is derived from keccak256(${m[2]}).`,m[1]);
      deps.push(dep(`Role ${m[1]}`,"admin","high",0.93,["role-based privileged control"],[e]));
    }
    for(const m of f.content.matchAll(/\b(I[A-Z][A-Za-z0-9_]+)\s*\(/g)){
      const interfaceName=m[1];
      if(!contractByName.has(interfaceName)&&!/^(IERC|IUniswap|IAccess|IBeacon|IProxy|IOracle|IPyth|ITellor|IWETH|IERC)/.test(interfaceName))continue;
      const d=dep(`Interface ${interfaceName}`,"external-contract","medium",0.9,["typed external dependency"],[sourceEvidence(f.path,f.content,m.index??0,`Typed external interface cast/call ${interfaceName}.`,interfaceName)]);
      deps.push(d);links.push({from:"root",to:d.id,relation:"interface call"});
    }
    const typedReceivers=new Set<string>();
    for(const tm of f.content.matchAll(/\b(I[A-Z][A-Za-z0-9_]+|[A-Z][A-Za-z0-9_]+)\s+(?:public|private|internal|external|immutable)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|;)/g)){
      typedReceivers.add(tm[2]);
    }
    for(const m of f.content.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)){
      const receiver=m[1],method=m[2];
      if(!typedReceivers.has(receiver))continue;
      const e=sourceEvidence(f.path,f.content,m.index??0,`Typed external/member call ${receiver}.${method}().`);
      const d=dep(`External call ${receiver}.${method}()`,"external-contract","medium",0.84,["runtime call surface"],[e]);
      deps.push(d);
    }
  }
  if(contracts.length)log(logs,"info",`Parsed ${contracts.length} Solidity contracts/interfaces/libraries from source, independent of compiler success.`);
  return contracts;
}

async function sourceAnalyze(files:SourceFile[],logs:any[]){
  const sources:any={};for(const f of files)if(f.path.endsWith(".sol"))sources[f.path]={content:f.content};
  const contracts=parseSourceContracts(files);
  const pragmas=pragmaVersions(files);
  let compiled:any={};let compilerVersion:string|null=null;
  if(Object.keys(sources).length){
    log(logs,"info",`Compiling ${Object.keys(sources).length} Solidity source files; detected pragmas: ${pragmas.join(", ")||"none"}`);
    const selected=await compilerForPragmas(pragmas,logs);compilerVersion=selected.version;
    if(selected.compiler){
      const input={language:"Solidity",sources,settings:{outputSelection:{"*":{"*":["abi","metadata","evm.deployedBytecode.object","storageLayout"]}}}};
      try{compiled=JSON.parse(selected.compiler.compile(JSON.stringify(input),{import:(p:string)=>{const f=resolveImport("",p,files);return f?{contents:f.content}:{error:"not found"};}}));}
      catch{log(logs,"warn","Compiler invocation failed; source dependency extraction remains available.");}
      const errors=(compiled.errors||[]).filter((e:any)=>e.severity==="error");
      if(errors.length)log(logs,"warn",`${errors.length} compiler errors; source/import/inheritance analysis was retained.`);
    }
  }
  for(const [file,cs] of Object.entries(compiled.contracts||{}))for(const [name,c] of Object.entries(cs as any)){
    const existing=contracts.find(x=>x.file===file&&x.name===name);
    if(existing){existing.abi=(c as any).abi||[];existing.bytecode=(c as any).evm?.deployedBytecode?.object||"";existing.storageLayout=(c as any).storageLayout;}
    else contracts.push({file,name,kind:"contract",bases:[],imports:[],abi:(c as any).abi||[],bytecode:(c as any).evm?.deployedBytecode?.object||"",storageLayout:(c as any).storageLayout});
  }
  return {contracts,compilerVersion,compilerErrors:(compiled.errors||[]).filter((e:any)=>e.severity==="error").length};
}

async function analyzeText(files:{path:string;content:string}[],label:string):Promise<Analysis>{
  const started=Date.now(),logs:any[]=[]; log(logs,"info","Input accepted");
  const sourceResult=await sourceAnalyze(files,logs); const contracts=sourceResult.contracts; const deps:Dependency[]=[]; const findings:any[]=[]; const links:any[]=[];
  sourceDependencies(files,contracts,logs,deps,links,findings);
  const addresses=new Set<string>();
  for(const f of files){
    const text=f.content, lower=text.toLowerCase();
    const matches=text.match(/0x[a-fA-F0-9]{40}/g)||[];
    for(const address of matches){
      const idx=lower.indexOf(address.toLowerCase()); const ctx=lower.slice(Math.max(0,idx-300),idx+300);
      if(addresses.has(address.toLowerCase()))continue; addresses.add(address.toLowerCase());
      let type:any="external-contract",severity:Severity="medium",caps=["external contract"];
      if(ORACLE_NAMES.test(ctx)){type="oracle";severity="high";caps=["price/data dependency"];}
      else if(BRIDGE_NAMES.test(ctx)){type="bridge";severity="high";caps=["cross-chain dependency"];}
      else if(ADMIN_NAMES.test(ctx)){type="admin";severity="high";caps=["privileged control"];}
      deps.push(dep(`Address ${address.slice(0,6)}…${address.slice(-4)}`,type,severity,0.76,caps,[{file:f.path,reason:"Address literal found in source near integration/trust-sensitive context.",source:"source",value:address}],address));
    }
    const patterns:[
      RegExp,string,Severity,string
    ][]=[
      [/\bdelegatecall\b/gi,"Delegatecall execution surface","high","delegatecall found; target code executes in caller storage context."],
      [/\btx\.origin\b/gi,"tx.origin authorization surface","medium","tx.origin found; review authorization assumptions."],
      [/\bselfdestruct\s*\(/gi,"Contract destruction path","high","selfdestruct found; review reachability and upgrade assumptions."],
      [/function\s+(upgradeTo|upgradeToAndCall|_authorizeUpgrade)\b/gi,"Upgradeable implementation control","critical","Upgrade entry point detected; authority can change implementation behavior."]
    ];
    for(const [rx,title,severity,description] of patterns)if(rx.test(text)){
      const evidence={file:f.path,reason:title,source:"source" as const};
      findings.push({id:id("find"),severity,title,description,confidence:0.9,evidence:[evidence]});
      if(title==="Upgradeable implementation control")
        deps.push(dep("Upgradeable implementation control","proxy","critical",0.91,["change implementation"],[{...evidence,reason:"Upgrade authorization/execution function detected in source."}]));
    }
    if(/\bgrantRole\s*\(|_setupRole\s*\(/i.test(text))
      deps.push(dep("Role administrator","admin","high",0.92,["grant/revoke roles"],[{file:f.path,reason:"Role-management logic detected.",source:"source",function:"grantRole/_setupRole"}]));
    if(/\blatestRoundData\s*\(/i.test(text))
      deps.push(dep("Price oracle","oracle","high",0.92,["price data"],[{file:f.path,reason:"latestRoundData oracle call detected.",source:"source",function:"latestRoundData"}]));
    if(/\b(IERC1967|ERC1967Upgrade|UUPSUpgradeable|TransparentUpgradeableProxy|BeaconProxy|UpgradeableBeacon)\b/i.test(text))
      deps.push(dep("Proxy/upgrade framework","proxy","high",0.88,["change implementation"],[{file:f.path,reason:"Known upgrade framework identifier detected.",source:"source"}]));
  }
  for(const c of contracts){
    const sigs=c.abi.filter((x:any)=>x.type==="function").map((x:any)=>`${x.name}(${(x.inputs||[]).map((i:any)=>i.type).join(",")})`);
    const joined=sigs.join(" ");
    if(/\bowner\(\)/.test(joined))deps.push(dep("Contract owner","owner","high",0.93,["privileged administration"],[{file:c.file,reason:"owner() in compiled ABI",source:"abi",function:"owner"}]));
    if(/\blatestRoundData\(\)/.test(joined))deps.push(dep("Oracle interface","oracle","high",0.9,["price data"],[{file:c.file,reason:"latestRoundData() in compiled ABI",source:"abi"}]));
    if(/\bproxiableUUID\(\)/.test(joined))deps.push(dep("UUPS upgrade surface","proxy","critical",0.94,["change implementation"],[{file:c.file,reason:"proxiableUUID() in ABI indicates UUPS-style compatibility.",source:"abi"}]));
  }
  const final=dedupe(deps); const g=graph(label,final,links);
  const durationMs=Date.now()-started;
  const summary={dependencyCount:final.length,critical:final.filter(x=>x.severity==="critical").length,high:final.filter(x=>x.severity==="high").length,medium:final.filter(x=>x.severity==="medium").length,low:final.filter(x=>x.severity==="low").length,privilegedControls:final.filter(x=>["admin","owner","multisig","proxy"].includes(x.type)).length,upgradeable:final.some(x=>x.type==="proxy")};
  log(logs,"success",`Analysis complete: ${final.length} dependencies, ${findings.length} findings`);
  return {id:id(),inputType:"zip",inputLabel:label,createdAt:now(),durationMs,status:"completed",root:{name:label},summary,dependencies:final,nodes:g.nodes,edges:g.edges,findings,logs,metadata:{contracts:contracts.length,solidityFiles:files.filter(f=>f.path.endsWith(".sol")).length,compilerVersion:sourceResult.compilerVersion,compilerErrors:sourceResult.compilerErrors,sourceAnalysis:"imports + inheritance + typed external interfaces + compiler-backed ABI analysis"}};
}

export async function analyzeFiles(files:{path:string;content:string}[],label:string){return analyzeText(files,label);}

export async function analyzeAddress(address:string,network:Network):Promise<Analysis>{
  const started=Date.now(),logs:any[]=[]; log(logs,"info",`Connecting to ${network}`);
  const {provider,code,block}=await getContractContext(address,network); const root=ethers.getAddress(address);
  log(logs,"success",`Contract found at block ${block}; bytecode ${Math.floor((code.length-2)/2)} bytes`);
  const deps:Dependency[]=[]; const findings:any[]=[]; const links:any[]=[];
  const slots=await readProxySlots(provider,root); const proxyProbe=await probeProxy(provider,root);
  if(slots.eip1967Implementation){
    deps.push(dep("Implementation contract","implementation","critical",0.99,["defines executable logic"],[{reason:"EIP-1967 implementation slot contains an address.",source:"storage",value:slots.eip1967Implementation}],slots.eip1967Implementation));
    deps.push(dep("Proxy upgrade surface","proxy","critical",0.98,["change implementation"],[{reason:"EIP-1967 implementation slot detected.",source:"storage",value:slots.eip1967Implementation}],root));
    findings.push({id:id("find"),severity:"critical",title:"EIP-1967 upgradeable proxy detected",description:"The implementation slot is populated. Changes to the implementation can alter protocol behavior.",confidence:0.99,evidence:[{reason:"EIP-1967 implementation storage slot",source:"storage",value:slots.eip1967Implementation}]});
  }
  if(slots.eip1967Admin)deps.push(dep("Proxy admin","admin","critical",0.99,["upgrade proxy"],[{reason:"EIP-1967 admin slot contains an address.",source:"storage",value:slots.eip1967Admin}],slots.eip1967Admin));
  if(slots.eip1967Beacon)deps.push(dep("Beacon contract","proxy","high",0.98,["defines implementation"],[{reason:"EIP-1967 beacon slot contains an address.",source:"storage",value:slots.eip1967Beacon}],slots.eip1967Beacon));
  if(proxyProbe.proxiableUUID){
    deps.push(dep("UUPS proxiable interface","proxy","high",0.96,["implementation upgrade interface"],[{reason:"proxiableUUID() returned successfully.",source:"rpc",function:"proxiableUUID",value:String(proxyProbe.proxiableUUID)}],root));
  }
  if(proxyProbe.implementation && ethers.isAddress(proxyProbe.implementation))
    deps.push(dep("Implementation() target","implementation","critical",0.94,["defines executable logic"],[{reason:"implementation() returned an address.",source:"rpc",function:"implementation",value:proxyProbe.implementation}],proxyProbe.implementation));
  if(proxyProbe.beacon && ethers.isAddress(proxyProbe.beacon))
    deps.push(dep("Beacon() target","proxy","high",0.94,["provides implementation"],[{reason:"beacon() returned an address.",source:"rpc",function:"beacon",value:proxyProbe.beacon}],proxyProbe.beacon));

  try{
    const ownerIface=new ethers.Interface(["function owner() view returns(address)","function admin() view returns(address)"]);
    for(const fn of ["owner","admin"]){
      try{
        const result=await provider.call({to:root,data:ownerIface.encodeFunctionData(fn)});
        if(result!=="0x"){
          const a=ownerIface.decodeFunctionResult(fn,result)[0];
          if(ethers.isAddress(a)&&a!==ethers.ZeroAddress)
            deps.push(dep(fn==="owner"?"Contract owner":"Contract admin",fn==="owner"?"owner":"admin","high",0.97,["privileged control"],[{reason:`${fn}() returned an address.`,source:"rpc",function:fn,value:a}],a));
        }
      }catch{}
    }
  }catch{}
  const roles=await readAccessControl(provider,root);
  for(const r of roles)deps.push(dep("DEFAULT_ADMIN_ROLE","admin","critical",0.96,["grant/revoke roles"],[{reason:`AccessControl reports ${r.count} DEFAULT_ADMIN_ROLE member(s).`,source:"rpc",function:"getRoleMemberCount",value:String(r.count)}]));
  if(roles.length)log(logs,"success",`Enumerated ${roles.length} AccessControl role set(s)`);

  // Trace real read-only calls where a known public getter exists. This exposes downstream contracts.
  const candidates=["owner()","admin()","implementation()","oracle()","asset()","token()","router()","bridge()"];
  const traceIface=new ethers.Interface(candidates.map(x=>`function ${x} view returns(address)`));
  for(const fn of candidates){
    try{
      const data=traceIface.encodeFunctionData(fn.split("(")[0]);
      const result=await provider.call({to:root,data});
      if(result==="0x")continue;
      const returned=traceIface.decodeFunctionResult(fn.split("(")[0],result)[0];
      if(!ethers.isAddress(returned)||returned===ethers.ZeroAddress)continue;
      const trace=await traceCall(provider,{to:root,data});
      const calls=trace?collectTraceAddresses(trace):[];
      if(calls.length)log(logs,"info",`${fn} read trace reached ${calls.length} address(es)`);
      const lower=fn.toLowerCase();
      const type=ORACLE_NAMES.test(lower)?"oracle":BRIDGE_NAMES.test(lower)?"bridge":ADMIN_NAMES.test(lower)?"admin":"external-contract";
      const sev:Severity=type==="oracle"||type==="bridge"?"high":"medium";
      deps.push(dep(`${fn.split("(")[0]}() target`,type,sev,0.88,[`${fn.split("(")[0]} dependency`],[{reason:`Public getter ${fn} returned an address.`,source:"rpc",function:fn,value:returned}],returned));
      for(const c of calls){
        if(c.address.toLowerCase()===root.toLowerCase())continue;
        const targetDep=deps.find(d=>d.address?.toLowerCase()===c.address.toLowerCase());
        if(targetDep)links.push({from:deps.find(d=>d.address?.toLowerCase()===returned.toLowerCase())?.id||"root",to:targetDep.id,relation:"runtime call"});
      }
    }catch{}
  }

  // Bytecode opcode presence is a weak signal and is explicitly labeled.
  const hex=code.slice(2).toLowerCase();
  if(hex.includes("f4"))deps.push(dep("DELEGATECALL surface","external-contract","medium",0.55,["external execution"],[{reason:"DELEGATECALL opcode appears in bytecode; target must be established by tracing/source.",source:"bytecode"}]));
  if(hex.includes("fa"))deps.push(dep("STATICCALL surface","external-contract","low",0.5,["external reads"],[{reason:"STATICCALL opcode appears in bytecode.",source:"bytecode"}]));

  const final=dedupe(deps); const g=graph(root,final,links);
  const durationMs=Date.now()-started;
  const summary={dependencyCount:final.length,critical:final.filter(x=>x.severity==="critical").length,high:final.filter(x=>x.severity==="high").length,medium:final.filter(x=>x.severity==="medium").length,low:final.filter(x=>x.severity==="low").length,privilegedControls:final.filter(x=>["admin","owner","multisig","proxy"].includes(x.type)).length,upgradeable:final.some(x=>x.type==="proxy")};
  log(logs,"success",`Analysis complete in ${durationMs} ms`);
  return {id:id(),inputType:"address",inputLabel:root,network,root:{address:root,name:root},createdAt:now(),durationMs,status:"completed",summary,dependencies:final,nodes:g.nodes,edges:g.edges,findings,logs,metadata:{block,bytecodeBytes:(code.length-2)/2,proxySlots:slots,proxyProbe,accessControlRoles:roles,traceSupported:true}};
}

export async function analyzeGithub(owner:string,repo:string):Promise<Analysis>{
  const files=await githubRepoFiles(owner,repo);
  if(!files.length)throw new Error("No Solidity/JSON files could be read from repository");
  const a=await analyzeText(files,`${owner}/${repo}`); a.inputType="github";
  a.metadata={...a.metadata,github:{owner,repo},filesRead:files.length};
  return a;
}
