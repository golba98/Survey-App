/**
 * Tests for src/submit.js
 *
 * Runs with Node.js built-in test runner (no extra dependencies required):
 *   node --test src/submit.test.js
 *   npm test
 *
 * These are unit tests that exercise the business-logic helpers exported by
 * submit.js plus the handleSubmit route using lightweight in-memory stubs for
 * the D1 binding and the Worker env object.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

/**
 * Build a minimal D1-like stub.
 * If `shouldFail` is true the insert will throw so we can test DB-error paths.
 */
function makeDb({ shouldFail = false, existingRow = null } = {}) {
  const rows = [];
  const throttleRows = new Map();

  return {
    rows,
    throttleRows,
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _bindings: [],
        bind(...args) {
          this._bindings = args;
          return this;
        },
        async first() {
          if (/FROM submission_throttle/i.test(sql)) {
            return throttleRows.get(this._bindings[0]) || null;
          }

          // Duplicate-check query
          return existingRow;
        },
        async run() {
          if (shouldFail) {
            throw new Error("SQLITE_CONSTRAINT: CHECK constraint failed");
          }

          if (/DELETE FROM submission_throttle/i.test(sql)) {
            return { meta: {} };
          }

          if (/INSERT INTO submission_throttle/i.test(sql)) {
            const [throttleKey, windowStartedAt, attemptCount, lastSeenAt] = this._bindings;
            throttleRows.set(throttleKey, {
              window_started_at: windowStartedAt,
              attempt_count: attemptCount,
              last_seen_at: lastSeenAt,
            });
            return { meta: {} };
          }

          const newRow = { id: rows.length + 1 };
          rows.push({ bindings: this._bindings });
          return { meta: { last_row_id: newRow.id } };
        },
        async all() {
          return { results: rows };
        },
      };
      return stmt;
    },
  };
}

/**
 * Build a minimal Worker env.
 */
function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    IP_HASH_SECRET: "test-secret",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    ALLOWED_ORIGINS: undefined,
    ...overrides,
  };
}

/**
 * Build a POST /submit Request with the given JSON body.
 */
function makeRequest(body, { method = "POST", headers = {} } = {}) {
  return new Request("http://localhost:8787/submit", {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "TestAgent/1.0",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A fully-valid survey payload. */
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

const REQUEST_OVERSIZE_BYTES = 17 * 1024;

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

// Dynamic import so we can run after stubs are defined.
let turnstileSuccess = true;

before(() => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: turnstileSuccess }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
});

const { handleSubmit } = await import("./submit.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleSubmit", () => {
  // -------------------------------------------------------------------------
  // Environment / configuration
  // -------------------------------------------------------------------------

  describe("when DB binding is missing", () => {
    it("returns 503 Service unavailable", async () => {
      const req = makeRequest(VALID_PAYLOAD);
      const env = makeEnv({ DB: undefined });
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, "Service unavailable.");
    });
  });

  describe("when IP_HASH_SECRET is missing", () => {
    it("returns 503 Service unavailable", async () => {
      const req = makeRequest(VALID_PAYLOAD);
      const env = makeEnv({ IP_HASH_SECRET: undefined });
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, "Service unavailable.");
    });
  });

  describe("when TURNSTILE_SECRET_KEY is missing", () => {
    it("returns 503 Service unavailable", async () => {
      const req = makeRequest(VALID_PAYLOAD);
      const env = makeEnv({ TURNSTILE_SECRET_KEY: undefined });
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, "Service unavailable.");
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method
  // -------------------------------------------------------------------------

  describe("with a disallowed HTTP method", () => {
    it("returns 405 for GET requests", async () => {
      // GET requests cannot have a body per the Fetch spec.
      const req = new Request("http://localhost:8787/submit", {
        method: "GET",
        headers: {
          "User-Agent": "TestAgent/1.0",
        },
      });
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 405);
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe("validation", () => {
    it("accepts a valid payload and returns 201", async () => {
      turnstileSuccess = true;
      const req = makeRequest(VALID_PAYLOAD);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(typeof body.id === "number");
    });

    it("accepts a valid payload with no comment (optional field)", async () => {
      const payload = { ...VALID_PAYLOAD, comment: "" };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 201);
    });

    it("accepts a valid payload with an absent comment field", async () => {
      const { comment: _omit, ...payloadWithoutComment } = VALID_PAYLOAD;
      const req = makeRequest(payloadWithoutComment);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 201);
    });

    it("returns 400 when a required field is missing (age_range)", async () => {
      const { age_range: _omit, ...payload } = VALID_PAYLOAD;
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Invalid submission.");
    });

    it("returns 400 when cut_back_on is empty", async () => {
      const payload = { ...VALID_PAYLOAD, cut_back_on: [] };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Invalid submission.");
    });

    it("returns 400 when a rating is out of range", async () => {
      const payload = { ...VALID_PAYLOAD, work_worry_rating: 6 };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Invalid submission.");
    });

    it("returns 400 when comment exceeds 500 characters", async () => {
      const payload = { ...VALID_PAYLOAD, comment: "x".repeat(501) };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Invalid submission.");
    });

    it("accepts a comment of exactly 500 characters", async () => {
      const payload = { ...VALID_PAYLOAD, comment: "a".repeat(500) };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 201);
    });

    it("returns 400 for an unexpected field", async () => {
      const payload = { ...VALID_PAYLOAD, injected_field: "bad" };
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
    });

    it("returns 400 when the Turnstile token is missing", async () => {
      const { turnstileToken: _omit, ...payload } = VALID_PAYLOAD;
      const req = makeRequest(payload);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Invalid submission.");
    });

    it("returns 400 when Turnstile verification fails", async () => {
      turnstileSuccess = false;
      const req = makeRequest(VALID_PAYLOAD);
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      turnstileSuccess = true;
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, "Spam check failed.");
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = makeRequest("not-json", {
        headers: { "Content-Type": "application/json", "User-Agent": "TestAgent/1.0" },
      });
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 400);
    });

    it("returns 413 for an oversized body", async () => {
      const req = makeRequest("x".repeat(REQUEST_OVERSIZE_BYTES), {
        headers: { "Content-Type": "application/json", "User-Agent": "TestAgent/1.0" },
      });
      const env = makeEnv();
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 413);
      const body = await res.json();
      assert.equal(body.error, "Request too large.");
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe("rate limiting", () => {
    it("returns 429 after more than three submissions from the same hashed IP in an hour", async () => {
      const env = makeEnv();
      const headers = {
        "CF-Connecting-IP": "203.0.113.10",
        "User-Agent": "RateLimitAgent/1.0",
      };

      for (let index = 0; index < 3; index += 1) {
        const res = await handleSubmit(makeRequest(VALID_PAYLOAD, { headers }), env);
        assert.notEqual(res.status, 429);
      }

      const limited = await handleSubmit(makeRequest(VALID_PAYLOAD, { headers }), env);
      assert.equal(limited.status, 429);
      const body = await limited.json();
      assert.equal(body.error, "Too many submissions.");
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate detection
  // -------------------------------------------------------------------------

  describe("duplicate submission", () => {
    it("returns 409 when the same ip_hash + user_agent already exists", async () => {
      // The stub's first() always returns existingRow when set.
      const db = makeDb({ existingRow: { id: 42 } });
      const env = makeEnv({ DB: db });
      const req = makeRequest(VALID_PAYLOAD);
      const res = await handleSubmit(req, env);
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.ok(/duplicate/i.test(body.error));
    });
  });

  // -------------------------------------------------------------------------
  // Database error
  // -------------------------------------------------------------------------

  describe("database insert failure", () => {
    it("returns 500 Internal server error when D1 insert throws", async () => {
      const db = makeDb({ shouldFail: true });
      const env = makeEnv({ DB: db });
      const req = makeRequest(VALID_PAYLOAD);
      const res = await handleSubmit(req, env);
      // The inner DB catch returns 500 via serverError()
      assert.equal(res.status, 500);
    });
  });
});
