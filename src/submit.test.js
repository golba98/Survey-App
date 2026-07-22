import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, submitInternals } from "./submit.js";

const VALID_PAYLOAD = {
  age_range: "22-25",
  status: "Student",
  main_pressure: "Rent",
  cost_increased: "Yes",
  cut_back_on: ["Eating out", "Clothing"],
  work_worry_rating: 4,
  income_keeps_up_rating: 2,
  transport_cost: "R301-R600",
  food_cost: "R501-R1000",
  comment: "",
  turnstileToken: "valid-turnstile-token",
};

let turnstileResult;

function makeDb({ failInsert = false } = {}) {
  const rows = [];
  const throttle = new Map();
  return {
    rows,
    throttle,
    prepare(sql) {
      return {
        sql,
        bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async run() {
          if (/INSERT INTO survey_responses/i.test(sql)) {
            if (failInsert) throw new Error("insert failed");
            rows.push(this.bindings);
          }
          return { success: true, meta: {} };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) {
        if (/DELETE FROM submission_throttle/i.test(statement.sql)) {
          const cutoff = statement.bindings[0];
          for (const [key, row] of throttle) if (row.last_seen_at < cutoff) throttle.delete(key);
          results.push({ success: true, results: [] });
          continue;
        }
        const [key, now, lastSeen, windowCutoff] = statement.bindings;
        const current = throttle.get(key);
        const attemptCount = !current || current.window_started_at <= windowCutoff
          ? 1
          : current.attempt_count + 1;
        throttle.set(key, {
          window_started_at: attemptCount === 1 ? now : current.window_started_at,
          attempt_count: attemptCount,
          last_seen_at: lastSeen,
        });
        results.push({ success: true, results: [{ attempt_count: attemptCount }] });
      }
      return results;
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    IP_HASH_SECRET: "test-hmac-secret",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    TURNSTILE_EXPECTED_HOSTNAME: "surveyapp.ink",
    TURNSTILE_ACTION: "survey_submit",
    ...overrides,
  };
}

function makeRequest(body = VALID_PAYLOAD, options = {}) {
  return new Request(options.url || "http://localhost:8787/submit", {
    method: options.method || "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  turnstileResult = { success: true, hostname: "surveyapp.ink", action: "survey_submit" };
  globalThis.fetch = async () => Response.json(turnstileResult);
});

describe("handleSubmit", () => {
  it("returns 503 when a required binding or secret is missing", async () => {
    assert.equal((await handleSubmit(makeRequest(), makeEnv({ DB: undefined }))).status, 503);
    assert.equal((await handleSubmit(makeRequest(), makeEnv({ IP_HASH_SECRET: undefined }))).status, 503);
    assert.equal((await handleSubmit(makeRequest(), makeEnv({ TURNSTILE_SECRET_KEY: undefined }))).status, 503);
  });

  it("rejects methods, cross-origin JSON, and invalid content types", async () => {
    assert.equal((await handleSubmit(makeRequest(null, { method: "GET" }), makeEnv())).status, 405);
    assert.equal((await handleSubmit(makeRequest(VALID_PAYLOAD, { headers: { Origin: "https://evil.example" } }), makeEnv())).status, 403);
    const request = makeRequest(VALID_PAYLOAD, { headers: { "Content-Type": "text/plain" } });
    assert.equal((await handleSubmit(request, makeEnv())).status, 400);
  });

  it("stores a valid response without returning an id or persisting a fingerprint", async () => {
    const env = makeEnv();
    const response = await handleSubmit(makeRequest(), env);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { success: true, message: "Survey submitted successfully." });
    assert.equal(env.DB.rows.length, 1);
    assert.equal(env.DB.rows[0].length, 10);
  });

  it("rejects missing fields, unexpected fields, duplicate choices, and long comments", async () => {
    const cases = [
      { ...VALID_PAYLOAD, age_range: undefined },
      { ...VALID_PAYLOAD, injected: "bad" },
      { ...VALID_PAYLOAD, cut_back_on: ["Data", "Data"] },
      { ...VALID_PAYLOAD, comment: "x".repeat(501) },
    ];
    for (const payload of cases) {
      assert.equal((await handleSubmit(makeRequest(payload), makeEnv())).status, 400);
    }
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    assert.equal((await handleSubmit(makeRequest("not-json"), makeEnv())).status, 400);
    assert.equal((await handleSubmit(makeRequest("x".repeat(17 * 1024)), makeEnv())).status, 413);
  });

  it("requires successful Turnstile hostname and action validation", async () => {
    turnstileResult = { success: false };
    assert.equal((await handleSubmit(makeRequest(), makeEnv())).status, 400);
    turnstileResult = { success: true, hostname: "evil.example", action: "survey_submit" };
    assert.equal((await handleSubmit(makeRequest(), makeEnv())).status, 400);
    turnstileResult = { success: true, hostname: "surveyapp.ink", action: "wrong" };
    assert.equal((await handleSubmit(makeRequest(), makeEnv())).status, 400);
  });

  it("returns 503 when Siteverify is unavailable", async () => {
    globalThis.fetch = async () => new Response("unavailable", { status: 502 });
    assert.equal((await handleSubmit(makeRequest(), makeEnv())).status, 503);
  });

  it("allows three attempts per hour and blocks the fourth", async () => {
    const env = makeEnv();
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await handleSubmit(makeRequest(), env)).status, 201);
    }
    assert.equal((await handleSubmit(makeRequest(), env)).status, 429);
  });

  it("returns 500 when the D1 insert fails", async () => {
    const response = await handleSubmit(makeRequest(), makeEnv({ DB: makeDb({ failInsert: true }) }));
    assert.equal(response.status, 500);
  });

  it("uses HMAC rather than a raw or unhashed client address", async () => {
    const key = await submitInternals.createThrottleKey("203.0.113.40", "secret");
    assert.equal(key.length, 64);
    assert.ok(!key.includes("203.0.113.40"));
  });
});
