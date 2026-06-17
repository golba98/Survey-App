import {
  jsonResponse,
  optionsResponse,
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
];

const THROTTLE_WINDOW_SECONDS = 60;
const THROTTLE_MAX_ATTEMPTS = 3;
const USER_AGENT_MAX_LENGTH = 255;
const COMMENT_MAX_LENGTH = 500;

export async function handleSubmit(request, env) {
  const allowCors = true;

  if (request.method === "OPTIONS") {
    return optionsResponse(request, env, ["POST", "OPTIONS"], allowCors);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST /submit." }, 405, {
      request,
      env,
      allowCors,
      extraHeaders: { Allow: "POST, OPTIONS" },
    });
  }

  const originRejection = rejectDisallowedOrigin(request, env, allowCors);
  if (originRejection) {
    return originRejection;
  }

  if (!env.DB) {
    return serviceUnavailable("Missing D1 binding for submit handler.", request, env, { allowCors });
  }

  if (!env.IP_HASH_SECRET) {
    return serviceUnavailable("Missing IP_HASH_SECRET for submit handler.", request, env, { allowCors });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400, {
      request,
      env,
      allowCors,
    });
  }

  const errors = [];
  const normalizedPayload = normalizePayload(payload, errors);
  if (errors.length > 0) {
    return jsonResponse({ error: "Validation failed.", details: errors }, 400, {
      request,
      env,
      allowCors,
    });
  }

  const userAgent = normalizeUserAgent(request.headers.get("User-Agent"));
  const ipHash = await hashIpAddress(request, env.IP_HASH_SECRET);
  const throttleKey = `${ipHash}:${userAgent}`;

  try {
    const throttleState = await checkAndUpdateThrottle(env.DB, throttleKey);
    if (throttleState.blocked) {
      return jsonResponse(
        { error: "Too many attempts. Please wait a minute before trying again." },
        429,
        { request, env, allowCors },
      );
    }

    const duplicate = await env.DB.prepare(
      "SELECT id FROM survey_responses WHERE ip_hash = ? AND user_agent = ? LIMIT 1",
    )
      .bind(ipHash, userAgent)
      .first();

    if (duplicate) {
      return jsonResponse(
        { error: "Duplicate submission detected. You have already submitted this survey." },
        409,
        { request, env, allowCors },
      );
    }

    const result = await env.DB.prepare(
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
        normalizedPayload.comment,
        ipHash,
        userAgent,
      )
      .run();

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
    return serverError("Submit handler failed.", error, request, env, { allowCors });
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

async function hashIpAddress(request, secret) {
  const ipAddress =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  const data = new TextEncoder().encode(`${secret}:${ipAddress}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeUserAgent(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "unknown";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, USER_AGENT_MAX_LENGTH);
}

async function checkAndUpdateThrottle(db, throttleKey) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(
    "SELECT window_started_at, attempt_count FROM submission_throttle WHERE throttle_key = ? LIMIT 1",
  )
    .bind(throttleKey)
    .first();

  const withinWindow =
    existing &&
    Number.isInteger(existing.window_started_at) &&
    now - existing.window_started_at < THROTTLE_WINDOW_SECONDS;
  const attemptCount = withinWindow ? existing.attempt_count + 1 : 1;

  await db.prepare(
    `INSERT INTO submission_throttle (throttle_key, window_started_at, attempt_count, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(throttle_key) DO UPDATE SET
       window_started_at = excluded.window_started_at,
       attempt_count = excluded.attempt_count,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(throttleKey, withinWindow ? existing.window_started_at : now, attemptCount, now)
    .run();

  return {
    blocked: withinWindow && attemptCount > THROTTLE_MAX_ATTEMPTS,
  };
}
