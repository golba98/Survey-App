import { handleExport } from "./export.js";
import { handleSubmit } from "./submit.js";
import { jsonResponse, serviceUnavailable, withStaticHeaders } from "./security.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
          env,
          extraHeaders: { Allow: "GET" },
        });
      }

      if (!env.TURNSTILE_SITE_KEY) {
        console.error("[config] Public Turnstile site key is not configured.", { path: url.pathname });
        return serviceUnavailable("Config route unavailable.", request, env);
      }

      return jsonResponse(
        { turnstileSiteKey: env.TURNSTILE_SITE_KEY },
        200,
        {
          request,
          env,
          extraHeaders: { "cache-control": "no-store" },
        },
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: `Route not found: ${url.pathname}` }, 404, {
        request,
        env,
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return withStaticHeaders(assetResponse);
  },
};
