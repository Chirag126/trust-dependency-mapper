import React,{useEffect,useRef,useState} from "react";
import * as d3 from "d3";

export default function Graph({analysis,onSelect}:{analysis:any,onSelect:(id:string)=>void}) {
  const ref=useRef<SVGSVGElement>(null);
  const [zoom,setZoom]=useState(1);
  useEffect(()=>{
    if(!ref.current)return;
    const svg=d3.select(ref.current); svg.selectAll("*").remove();
    const width=900,height=520;
    const g=svg.append("g");
    const nodes=analysis.nodes.map((n:any)=>({...n}));
    const edges=analysis.edges.map((e:any)=>({...e}));
    const sim=d3.forceSimulation(nodes)
      .force("link",d3.forceLink(edges).id((d:any)=>d.id).distance(125))
      .force("charge",d3.forceManyBody().strength(-420))
      .force("center",d3.forceCenter(width/2,height/2))
      .force("collision",d3.forceCollide().radius((d:any)=>d.kind==="root"?42:32));
    const link=g.selectAll(".link").data(edges).enter().append("line").attr("stroke","rgba(148,163,184,.35)").attr("stroke-width",1.5);
    const node=g.selectAll(".node").data(nodes).enter().append("g").attr("cursor","pointer")
      .call(d3.drag<any,any>().on("start",(e,d)=>{if(!e.active)sim.alphaTarget(.25).restart();d.fx=d.x;d.fy=d.y})
      .on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y}).on("end",(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null}) as any);
    node.append("circle").attr("r",(d:any)=>d.kind==="root"?27:20)
      .attr("fill",(d:any)=>d.kind==="root"?"#f8fafc":d.severity==="critical"?"#ef4444":d.severity==="high"?"#f59e0b":d.severity==="medium"?"#38bdf8":"#64748b")
      .attr("stroke","#0f172a").attr("stroke-width",4);
    node.append("text").text((d:any)=>d.label).attr("x",26).attr("y",4).attr("fill","#e2e8f0").attr("font-size",12);
    node.on("click",(_,d:any)=>d.dependencyId && onSelect(d.dependencyId));
    sim.on("tick",()=>{link.attr("x1",(d:any)=>d.source.x).attr("y1",(d:any)=>d.source.y).attr("x2",(d:any)=>d.target.x).attr("y2",(d:any)=>d.target.y);node.attr("transform",(d:any)=>`translate(${d.x},${d.y})`);});
    return ()=>{sim.stop();};
  },[analysis,onSelect]);
  return <div className="graph-wrap">
    <div className="graph-tools"><button onClick={()=>setZoom(z=>Math.min(1.5,z+.1))}>Zoom +</button><button onClick={()=>setZoom(z=>Math.max(.7,z-.1))}>Zoom −</button><span>Drag nodes • click a dependency</span></div>
    <svg ref={ref} viewBox="0 0 900 520" style={{transform:`scale(${zoom})`}}/>
  </div>
}
