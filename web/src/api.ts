export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const configuredBase = (import.meta.env.VITE_API_URL || "").trim();
  const productionFallback = "https://trust-dependency-mapper-api.onrender.com";

  // Local Vite uses its /api proxy. On Render, use the API service rather than
  // accidentally sending API requests to the static frontend (which returns 404).
  const pointsAtFrontend = /trust-dependency-mapper-web\.onrender\.com/i.test(configuredBase);
  const base = (configuredBase && !pointsAtFrontend
    ? configuredBase
    : import.meta.env.DEV
      ? ""
      : productionFallback
  ).replace(/\/+$/, "");
  const target = `${base}${url}`;

  const session = localStorage.getItem("tdm_session") || crypto.randomUUID();
  localStorage.setItem("tdm_session", session);

  const headers = new Headers(options.headers);
  headers.set("x-anonymous-session", session);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const token = (sessionStorage.getItem("tdm_organization_id") ? sessionStorage.getItem("tdm_user_access") : null) || sessionStorage.getItem("tdm_admin_access") || sessionStorage.getItem("tdm_user_access");
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const organizationId = sessionStorage.getItem("tdm_organization_id");
  if (organizationId && !headers.has("x-organization-id")) headers.set("x-organization-id", organizationId);

  let response: Response;
  try {
    response = await fetch(target, { ...options, headers });
  } catch {
    throw new Error(
      `Cannot reach the TDM API at ${target}. Check the Render API service and VITE_API_URL.`
    );
  }

  const readBody = async (res: Response): Promise<any> => {
    const text = await res.text().catch(() => "");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 300) };
    }
  };

  let data = await readBody(response);

  if (response.status === 401 && token && url.startsWith("/api/admin/")) {
    const refreshToken = sessionStorage.getItem("tdm_admin_refresh");
    if (refreshToken) {
      try {
        const refreshResponse = await fetch(`${base}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: refreshToken })
        });
        const refreshed = await readBody(refreshResponse);
        if (refreshResponse.ok && refreshed.access && refreshed.refresh) {
          sessionStorage.setItem("tdm_admin_access", refreshed.access);
          sessionStorage.setItem("tdm_admin_refresh", refreshed.refresh);
          headers.set("Authorization", `Bearer ${refreshed.access}`);
          response = await fetch(target, { ...options, headers });
          data = await readBody(response);
        }
      } catch {
        // Preserve the original authorization error below.
      }
    }
  }

  if (response.status === 401 && token && sessionStorage.getItem("tdm_user_refresh") && !url.startsWith("/api/accounts/login") && !url.startsWith("/api/accounts/refresh") && !url.startsWith("/api/accounts/logout") && !url.startsWith("/api/admin/")) {
    try {
      const refreshedResponse = await fetch(`${base}/api/accounts/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: sessionStorage.getItem("tdm_user_refresh") })
      });
      const refreshed = await readBody(refreshedResponse);
      if (refreshedResponse.ok && refreshed.access && refreshed.refresh) {
        sessionStorage.setItem("tdm_user_access", refreshed.access);
        sessionStorage.setItem("tdm_user_refresh", refreshed.refresh);
        headers.set("Authorization", `Bearer ${refreshed.access}`);
        response = await fetch(target, { ...options, headers });
        data = await readBody(response);
      } else {
        sessionStorage.removeItem("tdm_user_access");
        sessionStorage.removeItem("tdm_user_refresh");
        sessionStorage.removeItem("tdm_organization_id");
      }
    } catch {
      // Preserve the original authorization error if refresh cannot reach the API.
    }
  }

  if (!response.ok) {
    if (response.status === 404 && url.startsWith("/api/")) {
      const bodyError = typeof data.error === "string" && !data.error.startsWith("<!DOCTYPE")
        ? data.error
        : "API endpoint returned 404. Check that the Render backend deployed the latest commit and VITE_API_URL points to the API service.";
      throw new Error(bodyError);
    }
    const message = typeof data.error === "string" && data.error.length
      ? data.error
      : `Request failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }

  return data as T;
}
