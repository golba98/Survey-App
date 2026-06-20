import {
  jsonResponse,
  rejectDisallowedOrigin,
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

const ACCEPTED_FIELDS = [
  "age_range",
  "status",
  "main_pressure",
  "cost_increased",
  "cut_back_on",
  "work_worry_rating",
  "income_keeps_up_rating",
  "transport_cost",
  "food_cost",
  "comment",
  "turnstileToken",
];

const REQUEST_MAX_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_SUBMISSIONS = 3;
const RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60;
const USER_AGENT_MAX_LENGTH = 255;
const COMMENT_MAX_LENGTH = 500;

export async function handleSubmit(request, env) {
  const allowCors = true;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, {
      request,
      env,
      allowCors,
      extraHeaders: { Allow: "POST" },
    });
  }

  const originRejection = rejectDisallowedOrigin(request, env, allowCors);
  if (originRejection) {
    return originRejection;
  }

  if (!env.DB) {
    console.error("[submit] D1 binding is not configured.", { path: new URL(request.url).pathname });
    return serviceUnavailable("Submit service unavailable.", request, env, { allowCors });
  }

  if (!env.IP_HASH_SECRET) {
    console.error("[submit] IP hash secret is not configured.", { path: new URL(request.url).pathname });
    return serviceUnavailable("Submit service unavailable.", request, env, { allowCors });
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    console.error("[submit] Turnstile secret is not configured.", { path: new URL(request.url).pathname });
    return serviceUnavailable("Submit service unavailable.", request, env, { allowCors });
  }

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) {
    return jsonResponse({ error: parsedBody.status === 413 ? "Request too large." : "Invalid submission." }, parsedBody.status, {
      request,
      env,
      allowCors,
    });
  }

  const payload = parsedBody.value;
  const errors = [];
  const normalizedPayload = normalizePayload(payload, errors);
  if (errors.length > 0) {
    console.warn("[submit] Validation failed.", { errorCount: errors.length });
    return jsonResponse({ error: "Invalid submission." }, 400, {
      request,
      env,
      allowCors,
    });
  }

  const userAgent = normalizeUserAgent(request.headers.get("User-Agent"));
  const ipHash = await hashIpAddress(request, env.IP_HASH_SECRET);

  try {
    await cleanupOldRateLimitRows(env.DB);
    const rateLimitState = await checkAndUpdateRateLimit(env.DB, ipHash);
    if (rateLimitState.blocked) {
      console.warn("[submit] Rate limit reached.", { ipHash });
      return jsonResponse(
        { error: "Too many submissions." },
        429,
        { request, env, allowCors },
      );
    }

    const turnstileResult = await verifyTurnstileToken(
      normalizedPayload.turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      getRequesterIp(request),
    );
    if (!turnstileResult) {
      console.warn("[submit] Turnstile verification failed.");
      return jsonResponse({ error: "Spam check failed." }, 400, {
        request,
        env,
        allowCors,
      });
    }

    const duplicate = await env.DB.prepare(
      "SELECT id FROM survey_responses WHERE ip_hash = ? AND user_agent = ? LIMIT 1",
    )
      .bind(ipHash, userAgent)
      .first();

    if (duplicate) {
      console.info("[submit] Duplicate submission rejected.", { duplicateId: duplicate.id });
      return jsonResponse(
        { error: "Duplicate submission detected. You have already submitted this survey." },
        409,
        { request, env, allowCors },
      );
    }

    let result;
    try {
      result = await env.DB.prepare(
        `INSERT INTO survey_responses (
          age_range,
          status,
          main_pressure,
          cost_increased,
          cut_back_on,
          work_worry_rating,
          income_keeps_up_rating,
          transport_cost,
          food_cost,
          comment,
          ip_hash,
          user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          normalizedPayload.age_range,
          normalizedPayload.status,
          normalizedPayload.main_pressure,
          normalizedPayload.cost_increased,
          JSON.stringify(normalizedPayload.cut_back_on),
          normalizedPayload.work_worry_rating,
          normalizedPayload.income_keeps_up_rating,
          normalizedPayload.transport_cost,
          normalizedPayload.food_cost,
          normalizedPayload.comment ?? null,
          ipHash,
          userAgent,
        )
        .run();
    } catch (dbError) {
      console.error("[submit] D1 insert failed.", {
        errorType: dbError instanceof Error ? dbError.name : typeof dbError,
      });
      return serverError("Database insert failed.", dbError, request, env, { allowCors });
    }

    console.info("[submit] Survey response saved.", { id: result.meta.last_row_id });

    return jsonResponse(
      {
        success: true,
        message: "Survey submitted successfully.",
        id: result.meta.last_row_id,
      },
      201,
      { request, env, allowCors },
    );
  } catch (error) {
    console.error("[submit] Unexpected error in submit handler.", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return serverError("Submit handler failed.", error, request, env, { allowCors });
  }
}

async function parseJsonBody(request) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const numericContentLength = Number(contentLength);
    if (!Number.isFinite(numericContentLength) || numericContentLength > REQUEST_MAX_BYTES) {
      return { ok: false, status: 413 };
    }
  }

  const bodyResult = await readBodyWithLimit(request, REQUEST_MAX_BYTES);
  if (!bodyResult.ok) {
    return { ok: false, status: 413 };
  }

  try {
    return { ok: true, value: JSON.parse(bodyResult.text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

async function readBodyWithLimit(request, maxBytes) {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      return { ok: true, text };
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }

    text += decoder.decode(value, { stream: true });
  }
}

function normalizePayload(payload, errors) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("Payload must be a JSON object.");
    return null;
  }

  const unexpectedFields = Object.keys(payload).filter((field) => !ACCEPTED_FIELDS.includes(field));
  if (unexpectedFields.length > 0) {
    errors.push(`Unexpected field(s): ${unexpectedFields.join(", ")}.`);
  }

  const normalized = {
    age_range: normalizeChoice(payload.age_range),
    status: normalizeChoice(payload.status),
    main_pressure: normalizeChoice(payload.main_pressure),
    cost_increased: normalizeChoice(payload.cost_increased),
    transport_cost: normalizeChoice(payload.transport_cost),
    food_cost: normalizeChoice(payload.food_cost),
    work_worry_rating: normalizeRating(payload.work_worry_rating),
    income_keeps_up_rating: normalizeRating(payload.income_keeps_up_rating),
    cut_back_on: normalizeCutBackOn(payload.cut_back_on, errors),
    comment: normalizeComment(payload.comment, errors),
    turnstileToken: normalizeTurnstileToken(payload.turnstileToken, errors),
  };

  validateChoice(errors, normalized.age_range, "Age range", VALID_OPTIONS.age_range);
  validateChoice(errors, normalized.status, "Status", VALID_OPTIONS.status);
  validateChoice(errors, normalized.main_pressure, "Main monthly pressure", VALID_OPTIONS.main_pressure);
  validateChoice(errors, normalized.cost_increased, "Cost of living increase", VALID_OPTIONS.cost_increased);
  validateChoice(errors, normalized.transport_cost, "Monthly transport cost", VALID_OPTIONS.transport_cost);
  validateChoice(errors, normalized.food_cost, "Monthly food cost", VALID_OPTIONS.food_cost);
  validateRating(errors, normalized.work_worry_rating, "Work worry rating");
  validateRating(errors, normalized.income_keeps_up_rating, "Income/allowance keeps up rating");

  return normalized;
}

function normalizeChoice(value) {
  return typeof value === "string" ? value.trim() : null;
}

function validateChoice(errors, value, label, allowedValues) {
  if (!allowedValues.includes(value)) {
    errors.push(`${label} must be one of the allowed options.`);
  }
}

function normalizeRating(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : Number.NaN;
}

function validateRating(errors, value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    errors.push(`${label} must be an integer between 1 and 5.`);
  }
}

function normalizeCutBackOn(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("Please select at least one option for cut back on.");
    return [];
  }

  const normalizedValues = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (normalizedValues.some((item) => !VALID_OPTIONS.cut_back_on.includes(item))) {
    errors.push("Cut back on contains an invalid option.");
  }

  if (new Set(normalizedValues).size !== normalizedValues.length) {
    errors.push("Cut back on cannot contain duplicate values.");
  }

  return normalizedValues;
}

function normalizeComment(comment, errors) {
  if (comment === undefined || comment === null || comment === "") {
    return null;
  }

  if (typeof comment !== "string") {
    errors.push("Comment must be plain text.");
    return null;
  }

  const trimmed = comment.trim();
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    errors.push(`Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`);
  }

  return trimmed === "" ? null : trimmed;
}

function normalizeTurnstileToken(value, errors) {
  if (typeof value !== "string") {
    errors.push("Turnstile token is required.");
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    errors.push("Turnstile token is required.");
    return null;
  }

  return trimmed;
}

async function hashIpAddress(request, secret) {
  const ipAddress = getRequesterIp(request);
  const data = new TextEncoder().encode(`${secret}:${ipAddress}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getRequesterIp(request) {
  const forwardedFor = request.headers.get("X-Forwarded-For");
  const firstForwardedIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "";

  return request.headers.get("CF-Connecting-IP") || firstForwardedIp || "unknown";
}

function normalizeUserAgent(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "unknown";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, USER_AGENT_MAX_LENGTH);
}

async function verifyTurnstileToken(token, secretKey, remoteIp) {
  const body = new FormData();
  body.set("secret", secretKey);
  body.set("response", token);
  if (remoteIp && remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });

    if (!response.ok) {
      console.warn("[submit] Turnstile Siteverify returned a non-OK response.", { status: response.status });
      return false;
    }

    const result = await response.json();
    return result?.success === true;
  } catch (error) {
    console.error("[submit] Turnstile Siteverify request failed.", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

async function cleanupOldRateLimitRows(db) {
  const cutoff = Math.floor(Date.now() / 1000) - RATE_LIMIT_RETENTION_SECONDS;
  await db.prepare("DELETE FROM submission_throttle WHERE last_seen_at < ?").bind(cutoff).run();
}

async function checkAndUpdateRateLimit(db, ipHash) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(
    "SELECT window_started_at, attempt_count FROM submission_throttle WHERE throttle_key = ? LIMIT 1",
  )
    .bind(ipHash)
    .first();

  const withinWindow =
    existing &&
    Number.isInteger(existing.window_started_at) &&
    now - existing.window_started_at < RATE_LIMIT_WINDOW_SECONDS;
  const attemptCount = withinWindow ? existing.attempt_count + 1 : 1;

  await db.prepare(
    `INSERT INTO submission_throttle (throttle_key, window_started_at, attempt_count, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(throttle_key) DO UPDATE SET
       window_started_at = excluded.window_started_at,
       attempt_count = excluded.attempt_count,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(ipHash, withinWindow ? existing.window_started_at : now, attemptCount, now)
    .run();

  return {
    blocked: withinWindow && attemptCount > RATE_LIMIT_MAX_SUBMISSIONS,
  };
}
