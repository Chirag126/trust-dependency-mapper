import { ethers } from "ethers";
import AdmZip from "adm-zip";
import { config } from "./config";
import { withTimeout } from "./chain";

function eip1967Slot(label:string){
  const hash=BigInt(ethers.keccak256(ethers.toUtf8Bytes(label)));
  return ethers.toBeHex(hash-1n,32);
}

export const PROXY_SLOTS = {
  eip1967Implementation:eip1967Slot("eip1967.proxy.implementation"),
  eip1967Admin:eip1967Slot("eip1967.proxy.admin"),
  eip1967Beacon:eip1967Slot("eip1967.proxy.beacon")
};

export const PROXY_STANDARDS = {
  eip1967:"EIP-1967 storage slots",
  erc1822:"ERC-1822 / UUPS proxiableUUID()",
  eip1167:"EIP-1167 minimal proxy / clone",
  eip2535:"EIP-2535 Diamond facets"
};

export async function readProxySlots(provider:ethers.JsonRpcProvider,address:string){
  const out:Record<string,string>={};
  const slots=[
    ["eip1967Implementation",PROXY_SLOTS.eip1967Implementation],
    ["eip1967Admin",PROXY_SLOTS.eip1967Admin],
    ["eip1967Beacon",PROXY_SLOTS.eip1967Beacon]
  ];
  for(const [name,slot] of slots){
    try{
      const value=await withTimeout(provider.getStorage(address,slot));
      if(value&&!/^0x0+$/.test(value)){
        const candidate="0x"+value.slice(-40);
        if(ethers.isAddress(candidate)&&candidate!==ethers.ZeroAddress)out[name]=ethers.getAddress(candidate);
      }
    }catch{}
  }
  return out;
}

export async function probeProxy(provider:ethers.JsonRpcProvider,address:string){
  const iface=new ethers.Interface([
    "function proxiableUUID() view returns(bytes32)",
    "function implementation() view returns(address)",
    "function beacon() view returns(address)"
  ]);
  const out:any={};
  for(const fn of ["proxiableUUID","implementation","beacon"]){
    try{
      const data=iface.encodeFunctionData(fn);
      const result=await withTimeout(provider.call({to:address,data}));
      if(result!=="0x")out[fn]=iface.decodeFunctionResult(fn,result)[0];
    }catch{}
  }
  return out;
}

export async function readAccessControl(provider:ethers.JsonRpcProvider,address:string){
  const iface=new ethers.Interface([
    "function DEFAULT_ADMIN_ROLE() view returns(bytes32)",
    "function getRoleMemberCount(bytes32) view returns(uint256)",
    "function getRoleMember(bytes32,uint256) view returns(address)",
    "function hasRole(bytes32,address) view returns(bool)"
  ]);
  const roles:any[]=[];
  try{
    const r=await provider.call({to:address,data:iface.encodeFunctionData("DEFAULT_ADMIN_ROLE")});
    if(r!=="0x"){
      const role=iface.decodeFunctionResult("DEFAULT_ADMIN_ROLE",r)[0];
      const c=await provider.call({to:address,data:iface.encodeFunctionData("getRoleMemberCount", [role])});
      const count=Number(iface.decodeFunctionResult("getRoleMemberCount",c)[0]);
      const members:string[]=[];
      for(let i=0;i<Math.min(count,100);i++){
        try{
          const m=await provider.call({to:address,data:iface.encodeFunctionData("getRoleMember",[role,i])});
          members.push(iface.decodeFunctionResult("getRoleMember",m)[0]);
        }catch{}
      }
      roles.push({role,count,members});
    }
  }catch{}
  return roles;
}

export async function fetchSourcify(address:string,chainId:number){
  const url=`https://repo.sourcify.dev/contracts/full_match/${chainId}/${address}/metadata.json`;
  try{const res=await fetch(url);if(!res.ok)return null;return await res.json();}catch{return null;}
}

async function fetchWithTimeout(url:string,init:RequestInit={},timeoutMs=20_000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...init,signal:controller.signal});}
  catch(e:any){
    if(e?.name==="AbortError")throw new Error(`GitHub request timed out after ${Math.round(timeoutMs/1000)}s`);
    throw e;
  }
  finally{clearTimeout(timer);}
}

function githubHeaders(){
  const headers:Record<string,string>={"Accept":"application/vnd.github+json","User-Agent":"trust-dependency-mapper"};
  if(config.githubToken)headers.Authorization=`Bearer ${config.githubToken}`;
  return headers;
}

async function githubResponseError(res:Response,kind:string){
  const remaining=res.headers.get("x-ratelimit-remaining");
  const reset=res.headers.get("x-ratelimit-reset");
  if(res.status===403||res.status===429){
    const resetText=reset?` Rate-limit reset epoch: ${reset}.`:"";
    return `GitHub ${kind} request was rate-limited (${res.status}).${remaining!==null?` Remaining requests: ${remaining}.`:""}${resetText}${config.githubToken?"":" Set GITHUB_TOKEN in Render for higher API limits."}`;
  }
  let body="";
  try{body=(await res.text()).replace(/\s+/g," ").slice(0,240);}catch{}
  return `GitHub ${kind} request failed (${res.status})${body?`: ${body}`:""}`;
}

export async function fetchGithubFile(owner:string,repo:string,path:string){
  const res=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`,{headers:githubHeaders()});
  if(!res.ok)throw new Error(await githubResponseError(res,"file"));
  const json:any=await res.json();
  if(!json.content)throw new Error("GitHub item is not a file");
  return Buffer.from(json.content.replace(/\n/g,""),"base64").toString("utf8");
}

export async function listGithubTree(owner:string,repo:string){
  const metaRes=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`,{headers:githubHeaders()});
  if(!metaRes.ok)throw new Error(await githubResponseError(metaRes,"repository metadata"));
  const meta:any=await metaRes.json();
  if(!meta.default_branch)throw new Error("Unable to read repository metadata: default branch missing");
  const res=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURI(meta.default_branch)}?recursive=1`,{headers:githubHeaders()});
  if(!res.ok)throw new Error(await githubResponseError(res,"repository tree"));
  const tree:any=await res.json();
  if(tree.truncated)throw new Error("GitHub repository tree is too large; use a GitHub token or upload the project ZIP instead");
  return {branch:meta.default_branch,tree:tree.tree||[]};
}

function extractGithubArchive(buffer:Buffer){
  const zip=new AdmZip(buffer);
  const entries=zip.getEntries();
  if(entries.length>5000)throw new Error("GitHub repository archive contains too many files");
  const result:{path:string;content:string}[]=[];
  let totalBytes=0;
  for(const e of entries){
    if(e.isDirectory)continue;
    const n=e.entryName.replace(/\\/g,"/");
    const parts=n.split("/");
    const relative=parts.length>1?parts.slice(1).join("/"):parts[0];
    if(!relative||!/^.+\.(sol|json)$/i.test(relative))continue;
    const data=e.getData();
    if(data.length>1_000_000)continue;
    totalBytes+=data.length;
    if(totalBytes>20*1024*1024)break;
    result.push({path:relative,content:data.toString("utf8")});
    if(result.length>=400)break;
  }
  return result;
}

async function fetchGithubArchive(owner:string,repo:string,branch:string){
  const url=`https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${encodeURI(branch)}`;
  const res=await fetchWithTimeout(url,{headers:config.githubToken?{Authorization:`Bearer ${config.githubToken}`}:{}},30_000);
  if(!res.ok)throw new Error(await githubResponseError(res,"archive"));
  return extractGithubArchive(Buffer.from(await res.arrayBuffer()));
}

export async function githubRepoFiles(owner:string,repo:string){
  // Public repositories are fetched as one archive instead of one Contents API call per file.
  // This avoids GitHub's low unauthenticated API limit during repeated demo analyses.
  const candidates:string[]=[];
  if(!config.githubToken){
    candidates.push("main","master");
    try{
      const metaRes=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`,{headers:githubHeaders()});
      if(metaRes.ok){
        const meta:any=await metaRes.json();
        if(meta.default_branch&&!candidates.includes(meta.default_branch))candidates.unshift(meta.default_branch);
      }
    }catch{}
  }else{
    const metaRes=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`,{headers:githubHeaders()});
    if(!metaRes.ok)throw new Error(await githubResponseError(metaRes,"repository metadata"));
    const meta:any=await metaRes.json();
    if(!meta.default_branch)throw new Error("Unable to read repository metadata: default branch missing");
    candidates.push(meta.default_branch);
  }

  let lastError:any=null;
  for(const branch of [...new Set(candidates)]){
    try{
      const result=await fetchGithubArchive(owner,repo,branch);
      if(result.length)return result;
      lastError=new Error(`GitHub archive for branch '${branch}' contained no Solidity/JSON files`);
    }catch(e){lastError=e;}
  }

  // If the common branch names failed and no token is configured, make one final API attempt
  // to discover a non-standard default branch and then download that branch as an archive.
  if(!config.githubToken){
    const metaRes=await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`,{headers:githubHeaders()});
    if(!metaRes.ok)throw new Error(await githubResponseError(metaRes,"repository metadata"));
    const meta:any=await metaRes.json();
    if(meta.default_branch&&!candidates.includes(meta.default_branch)){
      try{
        const result=await fetchGithubArchive(owner,repo,meta.default_branch);
        if(result.length)return result;
      }catch(e){lastError=e;}
    }
  }

  throw lastError||new Error("Unable to read GitHub repository archive");
}
