import { ethers } from "ethers";
import { config } from "./config";
import { withTimeout } from "./chain";

export const PROXY_SLOTS = {
  eip1967Implementation:"0x360894A13BA1A3210667C828492DB98DCA3E2077",
  eip1967Admin:"0xb53127684a568b3173ae13b9f8a6016cc3d4b1d",
  eip1967Beacon:"0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee3d7e5a5d0c6b5d5f5f5",
  uupsProxiable:"0xc5f16f0fc9b2f8f4f1d4f7d9f4e2f7e0e6b0f0e9b7b1a8c7f1b5d5d3f2a7f1a"
};
// Exact known EIP-1967 implementation/admin/beacon slots. UUPS is identified by proxiableUUID() below;
// the historical constant above is intentionally not treated as authoritative.

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

export async function fetchGithubFile(owner:string,repo:string,path:string){
  const headers:Record<string,string>={"Accept":"application/vnd.github+json"};
  if(config.githubToken)headers.Authorization=`Bearer ${config.githubToken}`;
  const res=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`,{headers});
  if(!res.ok)throw new Error(`GitHub API error ${res.status}`);
  const json:any=await res.json();
  if(!json.content)throw new Error("GitHub item is not a file");
  return Buffer.from(json.content,"base64").toString("utf8");
}
export async function listGithubTree(owner:string,repo:string){
  const headers:Record<string,string>={"Accept":"application/vnd.github+json"};
  if(config.githubToken)headers.Authorization=`Bearer ${config.githubToken}`;
  const meta:any=await (await fetch(`https://api.github.com/repos/${owner}/${repo}`,{headers})).json();
  if(!meta.default_branch)throw new Error("Unable to read repository metadata");
  const res=await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`,{headers});
  if(!res.ok)throw new Error(`GitHub tree error ${res.status}`);
  const tree:any=await res.json();
  return {branch:meta.default_branch,tree:tree.tree||[]};
}
export async function githubRepoFiles(owner:string,repo:string){
  const {tree}=await listGithubTree(owner,repo);
  const files=tree.filter((x:any)=>x.type==="blob"&&/\.(sol|json)$/i.test(x.path)).slice(0,400);
  const result:{path:string;content:string}[]=[];
  for(const f of files){try{const content=await fetchGithubFile(owner,repo,f.path);if(Buffer.byteLength(content,"utf8")<=1_000_000)result.push({path:f.path,content});}catch{}}
  return result;
}
