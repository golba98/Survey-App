import { handleExport } from "./export.js";
import { handleSubmit } from "./submit.js";
import { jsonResponse, withStaticHeaders } from "./security.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/submit") {
      return handleSubmit(request, env);
    }

    if (url.pathname === "/export") {
      return handleExport(request, env);
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
