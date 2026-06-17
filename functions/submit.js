const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const VALID_OPTIONS = {
  age_range: ["18-21", "22-25", "26-30", "31+"],
  status: ["Student", "Employed", "Unemployed", "Studying and working"],
  main_pressure: ["Food", "Transport", "Rent", "Electricity", "Data", "Tuition", "Debt"],
  cost_increased: ["Yes", "No", "Not sure"],
  cut_back_on: ["Eating out", "Meat", "Transport", "Subscriptions", "Clothing", "Social life", "Data"],
  transport_cost: ["R0-R300", "R301-R600", "R601-R1000", "R1001-R1500", "R1500+"],
  food_cost: ["R0-R500", "R501-R1000", "R1001-R2000", "R2001-R3000", "R3000+"],
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "POST, OPTIONS",
      },
    });
  }

  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed. Use POST /submit." },
      405,
      { Allow: "POST, OPTIONS" },
    );
  }

  if (!env.DB) {
    return json({ error: "D1 binding DB is not configured." }, 500);
  }

  if (!env.IP_HASH_SECRET) {
    return json({ error: "Missing IP_HASH_SECRET secret." }, 500);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const errors = validatePayload(payload);
  if (errors.length > 0) {
    return json({ error: "Validation failed.", details: errors }, 400);
  }

  const ipHash = await hashIpAddress(request, env.IP_HASH_SECRET);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM survey_responses WHERE ip_hash = ? LIMIT 1",
  ).bind(ipHash).first();

  if (duplicate) {
    return json(
      { error: "Duplicate submission detected. You have already submitted this survey." },
      409,
    );
  }

  const comment = normalizeComment(payload.comment);

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
      ip_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    payload.age_range,
    payload.status,
    payload.main_pressure,
    payload.cost_increased,
    JSON.stringify(payload.cut_back_on),
    Number(payload.work_worry_rating),
    Number(payload.income_keeps_up_rating),
    payload.transport_cost,
    payload.food_cost,
    comment,
    ipHash,
  ).run();

  return json(
    {
      success: true,
      message: "Survey submitted successfully.",
      id: result.meta.last_row_id,
    },
    201,
  );
}

function validatePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["Payload must be a JSON object."];
  }

  validateChoice(errors, payload, "age_range");
  validateChoice(errors, payload, "status");
  validateChoice(errors, payload, "main_pressure");
  validateChoice(errors, payload, "cost_increased");
  validateChoice(errors, payload, "transport_cost");
  validateChoice(errors, payload, "food_cost");

  if (!Array.isArray(payload.cut_back_on) || payload.cut_back_on.length === 0) {
    errors.push("Please select at least one option for cut_back_on.");
  } else if (payload.cut_back_on.some((value) => !VALID_OPTIONS.cut_back_on.includes(value))) {
    errors.push("cut_back_on contains an invalid option.");
  }

  validateRating(errors, payload.work_worry_rating, "work_worry_rating");
  validateRating(errors, payload.income_keeps_up_rating, "income_keeps_up_rating");

  if (payload.comment !== undefined && payload.comment !== null) {
    if (typeof payload.comment !== "string") {
      errors.push("comment must be a string.");
    } else if (payload.comment.trim().length > 2000) {
      errors.push("comment must be 2000 characters or fewer.");
    }
  }

  return errors;
}

function validateChoice(errors, payload, field) {
  if (!VALID_OPTIONS[field].includes(payload[field])) {
    errors.push(`${field} is required and must be a valid option.`);
  }
}

function validateRating(errors, value, field) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5) {
    errors.push(`${field} must be an integer between 1 and 5.`);
  }
}

function normalizeComment(comment) {
  if (typeof comment !== "string") {
    return null;
  }

  const trimmed = comment.trim();
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

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}
