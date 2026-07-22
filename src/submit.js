import {
  jsonResponse,
  rejectCrossOrigin,
  serverError,
  serviceUnavailable,
} from "./security.js";

const VALID_OPTIONS = {
  age_range: ["18-21", "22-25", "26-30", "31+"],
  status: ["Student", "Employed", "Unemployed", "Studying and working"],
  main_pressure: ["Food", "Transport", "Rent", "Electricity", "Data", "Tuition", "Debt"],
  cost_increased: ["Yes", "No", "Not sure"],
  cut_back_on: ["Eating out", "Meat", "Transport", "Subscriptions", "Clothing", "Social life", "Data"],
  transport_cost: ["R0-R300", "R301-R600", "R601-R1000", "R1001-R1500", "R1500+"],
  food_cost: ["R0-R500", "R501-R1000", "R1001-R2000", "R2001-R3000", "R3000+"],
};

const ACCEPTED_FIELDS = new Set([
  "age_range", "status", "main_pressure", "cost_increased", "cut_back_on",
  "work_worry_rating", "income_keeps_up_rating", "transport_cost", "food_cost",
  "comment", "turnstileToken",
]);
const REQUEST_MAX_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_SUBMISSIONS = 3;
const RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60;
const COMMENT_MAX_LENGTH = 500;
const TURNSTILE_TIMEOUT_MS = 5_000;

export async function handleSubmit(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, {
      request,
      extraHeaders: { Allow: "POST" },
    });
  }

  const originRejection = rejectCrossOrigin(request);
  if (originRejection) return originRejection;

  if (!env.DB || !env.IP_HASH_SECRET || !env.TURNSTILE_SECRET_KEY) {
    return serviceUnavailable("submit_missing_binding_or_secret", request);
  }

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) {
    return jsonResponse({
      error: parsedBody.status === 413 ? "Request too large." : "Invalid submission.",
    }, parsedBody.status, { request });
  }

  const normalized = normalizePayload(parsedBody.value);
  if (!normalized.ok) {
    console.warn(JSON.stringify({ event: "submit_validation_failed" }));
    return jsonResponse({ error: "Invalid submission." }, 400, { request });
  }

  const requesterIp = getRequesterIp(request);
  if (!requesterIp) {
    return serviceUnavailable("submit_missing_client_address", request);
  }

  const turnstile = await verifyTurnstileToken(
    normalized.value.turnstileToken,
    env,
    requesterIp,
  );
  if (!turnstile.ok) {
    const status = turnstile.unavailable ? 503 : 400;
    const error = turnstile.unavailable ? "Spam check unavailable." : "Spam check failed.";
    return jsonResponse({ error }, status, { request });
  }

  try {
    const throttleKey = await createThrottleKey(requesterIp, env.IP_HASH_SECRET);
    const rateLimit = await updateRateLimit(env.DB, throttleKey);
    if (rateLimit.blocked) {
      console.warn(JSON.stringify({ event: "submit_rate_limited" }));
      return jsonResponse({ error: "Too many submissions." }, 429, { request });
    }

    await env.DB.prepare(
      `INSERT INTO survey_responses (
        age_range, status, main_pressure, cost_increased, cut_back_on,
        work_worry_rating, income_keeps_up_rating, transport_cost, food_cost, comment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      normalized.value.age_range,
      normalized.value.status,
      normalized.value.main_pressure,
      normalized.value.cost_increased,
      JSON.stringify(normalized.value.cut_back_on),
      normalized.value.work_worry_rating,
      normalized.value.income_keeps_up_rating,
      normalized.value.transport_cost,
      normalized.value.food_cost,
      normalized.value.comment,
    ).run();

    console.info(JSON.stringify({ event: "survey_response_saved" }));
    return jsonResponse({
      success: true,
      message: "Survey submitted successfully.",
    }, 201, { request });
  } catch (error) {
    return serverError("submit_database_failure", error, request);
  }
}

async function parseJsonBody(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 400 };
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > REQUEST_MAX_BYTES) {
    return { ok: false, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > REQUEST_MAX_BYTES) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false };
  }
  if (Object.keys(payload).some((field) => !ACCEPTED_FIELDS.has(field))) {
    return { ok: false };
  }

  const cutBackOn = Array.isArray(payload.cut_back_on)
    ? payload.cut_back_on.map((value) => typeof value === "string" ? value.trim() : "")
    : [];
  const comment = payload.comment == null || payload.comment === ""
    ? null
    : typeof payload.comment === "string" ? payload.comment.trim() : false;
  const workRating = Number(payload.work_worry_rating);
  const incomeRating = Number(payload.income_keeps_up_rating);
  const token = typeof payload.turnstileToken === "string" ? payload.turnstileToken.trim() : "";

  const value = {
    age_range: normalizeChoice(payload.age_range),
    status: normalizeChoice(payload.status),
    main_pressure: normalizeChoice(payload.main_pressure),
    cost_increased: normalizeChoice(payload.cost_increased),
    cut_back_on: cutBackOn,
    work_worry_rating: workRating,
    income_keeps_up_rating: incomeRating,
    transport_cost: normalizeChoice(payload.transport_cost),
    food_cost: normalizeChoice(payload.food_cost),
    comment,
    turnstileToken: token,
  };

  const valid =
    VALID_OPTIONS.age_range.includes(value.age_range) &&
    VALID_OPTIONS.status.includes(value.status) &&
    VALID_OPTIONS.main_pressure.includes(value.main_pressure) &&
    VALID_OPTIONS.cost_increased.includes(value.cost_increased) &&
    VALID_OPTIONS.transport_cost.includes(value.transport_cost) &&
    VALID_OPTIONS.food_cost.includes(value.food_cost) &&
    cutBackOn.length > 0 &&
    cutBackOn.every((choice) => VALID_OPTIONS.cut_back_on.includes(choice)) &&
    new Set(cutBackOn).size === cutBackOn.length &&
    Number.isInteger(workRating) && workRating >= 1 && workRating <= 5 &&
    Number.isInteger(incomeRating) && incomeRating >= 1 && incomeRating <= 5 &&
    comment !== false && (comment === null || comment.length <= COMMENT_MAX_LENGTH) &&
    token.length > 0;

  return valid ? { ok: true, value } : { ok: false };
}

function normalizeChoice(value) {
  return typeof value === "string" ? value.trim() : null;
}

function getRequesterIp(request) {
  const cloudflareIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const hostname = new URL(request.url).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname) ? "127.0.0.1" : null;
}

async function createThrottleKey(ipAddress, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ipAddress));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstileToken(token, env, remoteIp) {
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  body.set("remoteip", remoteIp);
  body.set("idempotency_key", crypto.randomUUID());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, unavailable: true };

    const result = await response.json();
    const expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME || "surveyapp.ink";
    const expectedAction = env.TURNSTILE_ACTION || "survey_submit";
    return {
      ok: result?.success === true &&
        result?.hostname === expectedHostname &&
        result?.action === expectedAction,
      unavailable: false,
    };
  } catch {
    return { ok: false, unavailable: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function updateRateLimit(db, throttleKey) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - RATE_LIMIT_RETENTION_SECONDS;
  const windowCutoff = now - RATE_LIMIT_WINDOW_SECONDS;
  const results = await db.batch([
    db.prepare("DELETE FROM submission_throttle WHERE last_seen_at < ?").bind(cutoff),
    db.prepare(
      `INSERT INTO submission_throttle (throttle_key, window_started_at, attempt_count, last_seen_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(throttle_key) DO UPDATE SET
         window_started_at = CASE
           WHEN submission_throttle.window_started_at <= ? THEN excluded.window_started_at
           ELSE submission_throttle.window_started_at
         END,
         attempt_count = CASE
           WHEN submission_throttle.window_started_at <= ? THEN 1
           ELSE submission_throttle.attempt_count + 1
         END,
         last_seen_at = excluded.last_seen_at
       RETURNING attempt_count`,
    ).bind(throttleKey, now, now, windowCutoff, windowCutoff),
  ]);

  const attemptCount = Number(results[1]?.results?.[0]?.attempt_count);
  if (!Number.isInteger(attemptCount)) {
    throw new Error("D1 throttle update did not return an attempt count.");
  }
  return { blocked: attemptCount > RATE_LIMIT_MAX_SUBMISSIONS };
}

export const submitInternals = {
  createThrottleKey,
  normalizePayload,
  updateRateLimit,
  verifyTurnstileToken,
};
