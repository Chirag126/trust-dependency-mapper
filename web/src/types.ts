export interface Dependency {
  id:string; address?:string; name:string; type:string; severity:string; confidence:number;
  capabilities:string[]; evidence:{file?:string;line?:number;function?:string;selector?:string;reason:string;source:string;value?:string}[];
}
export interface Analysis {
  id:string; inputType:string; inputLabel:string; network?:string; root:{address?:string;name:string};
  createdAt:string; durationMs:number; status:string;
  summary:{dependencyCount:number;critical:number;high:number;medium:number;low:number;privilegedControls:number;upgradeable:boolean};
  dependencies:Dependency[]; nodes:any[]; edges:any[];
  findings:{id:string;severity:string;title:string;description:string;evidence:any[];confidence:number}[];
  logs:{ts:string;level:string;message:string}[]; metadata:any;
}
