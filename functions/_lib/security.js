const BASE_RESPONSE_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
};

const API_RESPONSE_HEADERS = {
  ...BASE_RESPONSE_HEADERS,
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

const DEFAULT_DEV_ORIGINS = new Set([
  "http://localhost:8788",
  "http://127.0.0.1:8788",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function jsonResponse(body, status, options = {}) {
  const { request, env, allowCors = false, extraHeaders = {} } = options;
  const headers = {
    ...API_RESPONSE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    ...getCorsHeaders(request, env, allowCors),
    ...extraHeaders,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

export function textResponse(body, status, options = {}) {
  const { request, env, allowCors = false, extraHeaders = {} } = options;
  const headers = {
    ...API_RESPONSE_HEADERS,
    ...getCorsHeaders(request, env, allowCors),
    ...extraHeaders,
  };

  return new Response(body, {
    status,
    headers,
  });
}

export function optionsResponse(request, env, methods, allowCors = false) {
  const corsHeaders = getCorsHeaders(request, env, allowCors);
  if (allowCors && request.headers.get("Origin") && corsHeaders === null) {
    return jsonResponse(
      { error: "Origin not allowed." },
      403,
      { request, env, allowCors: false },
    );
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...API_RESPONSE_HEADERS,
      ...corsHeaders,
      Allow: methods.join(", "),
    },
  });
}

export function rejectDisallowedOrigin(request, env, allowCors = false) {
  if (!allowCors) {
    return null;
  }

  const origin = request.headers.get("Origin");
  if (!origin) {
    return null;
  }

  return isAllowedOrigin(request, env, origin)
    ? null
    : jsonResponse(
        { error: "Origin not allowed." },
        403,
        { request, env, allowCors: false },
      );
}

export function serverError(message, error, request, env, options = {}) {
  const { allowCors = false } = options;
  console.error(message, {
    error: error instanceof Error ? error.message : String(error),
    path: request?.url,
    method: request?.method,
  });

  return jsonResponse(
    { error: "Internal server error." },
    500,
    { request, env, allowCors },
  );
}

export function serviceUnavailable(message, request, env, options = {}) {
  const { allowCors = false } = options;
  console.error(message, {
    path: request?.url,
    method: request?.method,
  });

  return jsonResponse(
    { error: "Service unavailable." },
    503,
    { request, env, allowCors },
  );
}

function getCorsHeaders(request, env, allowCors) {
  if (!allowCors) {
    return {};
  }

  const origin = request.headers.get("Origin");
  if (!origin) {
    return {};
  }

  if (!isAllowedOrigin(request, env, origin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function isAllowedOrigin(request, env, origin) {
  const requestOrigin = new URL(request.url).origin;
  if (origin === requestOrigin || DEFAULT_DEV_ORIGINS.has(origin)) {
    return true;
  }

  const configuredOrigins = parseAllowedOrigins(env?.ALLOWED_ORIGINS);
  return configuredOrigins.has(origin);
}

function parseAllowedOrigins(value) {
  if (!value || typeof value !== "string") {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}
