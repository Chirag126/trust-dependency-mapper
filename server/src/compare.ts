import { Analysis, Dependency } from "./types";
import { severityRank } from "./utils";

const key=(d:Dependency)=>`${d.type}|${(d.address||d.name).toLowerCase()}`;

export function compareAnalyses(a:Analysis,b:Analysis){
  const am=new Map(a.dependencies.map(d=>[key(d),d])),bm=new Map(b.dependencies.map(d=>[key(d),d]));
  const added:Dependency[]=[],removed:Dependency[]=[],changed:any[]=[];
  for(const [k,d] of bm){
    if(!am.has(k))added.push(d);else{
      const old=am.get(k)!;
      const caps=JSON.stringify(old.capabilities)!==JSON.stringify(d.capabilities);
      if(old.severity!==d.severity||Math.abs(old.confidence-d.confidence)>=.1||caps)
        changed.push({before:old,after:d});
    }
  }
  for(const [k,d] of am)if(!bm.has(k))removed.push(d);
  const risk=(x:Analysis)=>x.dependencies.reduce((n,d)=>n+severityRank(d.severity),0);
  return {before:{id:a.id,label:a.inputLabel,createdAt:a.createdAt},after:{id:b.id,label:b.inputLabel,createdAt:b.createdAt},
    added,removed,changed,summary:{added:added.length,removed:removed.length,changed:changed.length,riskDelta:risk(b)-risk(a)}};
}

export function blastRadius(a:Analysis,dependencyId:string){
  const seen=new Set([dependencyId]);const queue=[dependencyId];
  while(queue.length){
    const cur=queue.shift()!;
    for(const e of a.edges){
      if(e.source===cur&&!seen.has(e.target)){seen.add(e.target);queue.push(e.target);}
      if(e.target===cur&&!seen.has(e.source)){seen.add(e.source);queue.push(e.source);}
    }
  }
  return {root:a.root,dependencyId,reachableNodes:a.nodes.filter(n=>seen.has(n.id)),reachableEdges:a.edges.filter(e=>seen.has(e.source)&&seen.has(e.target)),
    explanation:`Reachability is based on the dependency/call graph discovered during this analysis. It is not a financial-loss estimate.`};
}
