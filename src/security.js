const BASE_RESPONSE_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const API_CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const STATIC_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "frame-src https://challenges.cloudflare.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self'",
  "form-action 'self'",
].join("; ");

export function responseHeaders(request, type = "api", extraHeaders = {}) {
  const headers = new Headers({
    ...BASE_RESPONSE_HEADERS,
    "Content-Security-Policy": type === "static" ? STATIC_CSP : API_CSP,
    ...extraHeaders,
  });

  if (request && new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }

  return headers;
}

export function jsonResponse(body, status, options = {}) {
  const headers = responseHeaders(options.request, "api", {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...options.extraHeaders,
  });

  return new Response(JSON.stringify(body), { status, headers });
}

export function rejectCrossOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin === new URL(request.url).origin) {
    return null;
  }

  return jsonResponse({ error: "Origin not allowed." }, 403, { request });
}

export function serverError(event, error, request) {
  console.error(JSON.stringify({
    event,
    errorType: error instanceof Error ? error.name : typeof error,
  }));

  return jsonResponse({ error: "Internal server error." }, 500, { request });
}

export function serviceUnavailable(event, request) {
  console.error(JSON.stringify({ event }));
  return jsonResponse({ error: "Service unavailable." }, 503, { request });
}

export function withStaticHeaders(response, request) {
  const headers = responseHeaders(request, "static");

  // Social crawlers and chat clients fetch preview images from their own origin,
  // so images opt out of the same-origin resource policy the rest of the site uses.
  if (response.headers.get("Content-Type")?.toLowerCase().startsWith("image/")) {
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }

  for (const [key, value] of response.headers) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
