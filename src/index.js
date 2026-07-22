import { handleExport } from "./export.js";
import { handleSubmit } from "./submit.js";
import { jsonResponse, serviceUnavailable, withStaticHeaders } from "./security.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === "/submit") {
      return handleSubmit(request, env);
    }

    if (url.pathname === "/export") {
      return handleExport(request, env);
    }

    if (url.pathname === "/config") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed." }, 405, {
          request,
          extraHeaders: { Allow: "GET" },
        });
      }

      if (!env.TURNSTILE_SITE_KEY) {
        return serviceUnavailable("config_missing_turnstile_site_key", request);
      }

      return jsonResponse({
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        turnstileAction: env.TURNSTILE_ACTION || "survey_submit",
      }, 200, { request });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "Route not found." }, 404, { request });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return withStaticHeaders(assetResponse, request);
  },
};
