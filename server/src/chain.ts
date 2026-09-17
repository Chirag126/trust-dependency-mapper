import { ethers } from "ethers";
import { config } from "./config";

export const networkConfig = {
  ethereum:{chainId:1,rpc:config.rpc.ethereum},
  sepolia:{chainId:11155111,rpc:config.rpc.sepolia},
  arbitrum:{chainId:42161,rpc:config.rpc.arbitrum},
  base:{chainId:8453,rpc:config.rpc.base}
} as const;
export const networks=Object.keys(networkConfig) as (keyof typeof networkConfig)[];
export type Network=keyof typeof networkConfig;

export function providerFor(network:Network) {
  const rpc=networkConfig[network].rpc;
  if(!rpc)throw new Error(`RPC is not configured for ${network}`);
  return new ethers.JsonRpcProvider(rpc,{chainId:networkConfig[network].chainId,name:network});
}
export async function withTimeout<T>(p:Promise<T>,ms=15000):Promise<T>{
  return await Promise.race([p,new Promise<T>((_,r)=>setTimeout(()=>r(new Error("RPC timeout")),ms))]);
}
export async function getContractContext(address:string,network:Network){
  if(!ethers.isAddress(address))throw new Error("Invalid EVM contract address");
  const provider=providerFor(network);
  const [code,block]=await Promise.all([withTimeout(provider.getCode(address)),withTimeout(provider.getBlockNumber())]);
  if(code==="0x")throw new Error("No contract bytecode found at this address");
  return {provider,code,block};
}
export async function traceCall(provider:ethers.JsonRpcProvider,tx:{to:string;data?:string;value?:string}) {
  const p:any=provider;
  if(typeof p.send!=="function")return null;
  try {
    return await withTimeout(p.send("debug_traceCall",[{
      to:tx.to,data:tx.data||"0x",value:tx.value||"0x0"
    }, "latest", {tracer:"callTracer"}]),20000);
  } catch { return null; }
}
export function collectTraceAddresses(trace:any) {
  const out=new Map<string,{address:string;calls:number;types:Set<string>}>();
  const walk=(t:any)=>{
    if(!t)return;
    const to=typeof t.to==="string"&&ethers.isAddress(t.to)?ethers.getAddress(t.to):null;
    if(to){
      const x=out.get(to)||{address:to,calls:0,types:new Set<string>()};
      x.calls++; if(t.type)x.types.add(String(t.type)); out.set(to,x);
    }
    if(Array.isArray(t.calls))t.calls.forEach(walk);
  };
  walk(trace);
  return [...out.values()].map(x=>({address:x.address,calls:x.calls,types:[...x.types]}));
}
