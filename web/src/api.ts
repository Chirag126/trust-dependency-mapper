export async function api<T>(url:string, options:RequestInit={}){
 const base=(import.meta.env.VITE_API_URL||"").replace(/\/$/,"");
 const target=`${base}${url}`;
 const session=localStorage.getItem("tdm_session")||crypto.randomUUID();localStorage.setItem("tdm_session",session);
 const headers=new Headers(options.headers);headers.set("x-anonymous-session",session);
 if(options.body&&!(options.body instanceof FormData))headers.set("Content-Type","application/json");
 const token=sessionStorage.getItem("tdm_admin_access");if(token&&!headers.has("Authorization"))headers.set("Authorization",`Bearer ${token}`);
 let res=await fetch(target,{...options,headers});let data=await res.json().catch(()=>({}));
 if(res.status===401&&token&&url.startsWith("/api/admin/")){
   const r=sessionStorage.getItem("tdm_admin_refresh");
   if(r){const rr=await fetch(`${base}/api/auth/refresh`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh:r})});const rd=await rr.json();
     if(rr.ok){sessionStorage.setItem("tdm_admin_access",rd.access);sessionStorage.setItem("tdm_admin_refresh",rd.refresh);headers.set("Authorization",`Bearer ${rd.access}`);res=await fetch(target,{...options,headers});data=await res.json().catch(()=>({}));}
   }
 }
 if(!res.ok)throw new Error(data.error||"Request failed");return data as T;
}
