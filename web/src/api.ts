export async function api<T>(url: string, options: RequestInit = {}) {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const target = `${base}${url}`;
  const session = localStorage.getItem("tdm_session") || crypto.randomUUID();
  localStorage.setItem("tdm_session", session);
  const headers = new Headers(options.headers);
  headers.set("x-anonymous-session", session);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = sessionStorage.getItem("tdm_admin_access");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const readBody = async (res: Response) => {
    const text = await res.text().catch(() => "");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 500) || `Unexpected response (${res.status})` };
    }
  };
  const request = async (urlToFetch: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      return await fetch(urlToFetch, { ...init, signal: controller.signal });
    }
    catch (e: any) {
      if (e?.name === "AbortError") throw new Error("The request timed out after 60 seconds. Try again or use a smaller repository.");
      throw new Error(`Unable to reach the analysis API at ${urlToFetch}. Check that the Render API service is running and VITE_API_URL is correct.`);
    } finally {
      clearTimeout(timeout);
    }
  };
  let res = await request(target, { ...options, headers });
  let data: any = await readBody(res);
  if (res.status === 401 && token && url.startsWith("/api/admin/")) {
    const r = sessionStorage.getItem("tdm_admin_refresh");
    if (r) {
      try {
        const rr = await request(`${base}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: r }) });
        const rd: any = await readBody(rr);
        if (rr.ok) {
          sessionStorage.setItem("tdm_admin_access", rd.access);
          sessionStorage.setItem("tdm_admin_refresh", rd.refresh);
          headers.set("Authorization", `Bearer ${rd.access}`);
          res = await request(target, { ...options, headers });
          data = await readBody(res);
        }
        else {
          sessionStorage.removeItem("tdm_admin_access");
          sessionStorage.removeItem("tdm_admin_refresh");
        }
      } catch {
        sessionStorage.removeItem("tdm_admin_access");
        sessionStorage.removeItem("tdm_admin_refresh");
      }
    }
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status} ${res.statusText})`);
  return data as T;
}
