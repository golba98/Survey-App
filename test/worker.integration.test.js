import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSubmit, submitInternals } from "../src/submit.js";

const VALID_PAYLOAD = {
  age_range: "22-25",
  status: "Student",
  main_pressure: "Rent",
  cost_increased: "Yes",
  cut_back_on: ["Eating out", "Data"],
  work_worry_rating: 4,
  income_keeps_up_rating: 2,
  transport_cost: "R301-R600",
  food_cost: "R501-R1000",
  comment: "integration test",
  turnstileToken: "valid-token",
};

const submitEnv = () => ({
  DB: env.DB,
  IP_HASH_SECRET: "integration-hmac-secret",
  TURNSTILE_SECRET_KEY: "integration-turnstile-secret",
  TURNSTILE_EXPECTED_HOSTNAME: "surveyapp.ink",
  TURNSTILE_ACTION: "survey_submit",
});

function request(payload = VALID_PAYLOAD, ip = "203.0.113.10") {
  return new Request("https://surveyapp.ink/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM survey_responses"),
    env.DB.prepare("DELETE FROM submission_throttle"),
  ]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    success: true,
    hostname: "surveyapp.ink",
    action: "survey_submit",
  })));
});

describe("Worker and D1 integration", () => {
  it("uses the privacy-preserving response schema", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(survey_responses)").all();
    const names = columns.results.map((column) => column.name);
    expect(names).not.toContain("ip_hash");
    expect(names).not.toContain("user_agent");
    expect(names).toContain("comment");
  });

  it("stores one validated response with no browser or network fingerprint", async () => {
    const response = await handleSubmit(request(), submitEnv());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      message: "Survey submitted successfully.",
    });

    const row = await env.DB.prepare("SELECT * FROM survey_responses").first();
    expect(row.comment).toBe("integration test");
    expect(JSON.parse(row.cut_back_on)).toEqual(["Eating out", "Data"]);
    expect(row).not.toHaveProperty("ip_hash");
    expect(row).not.toHaveProperty("user_agent");
  });

  it("atomically allows only three concurrent attempts per throttle key", async () => {
    const key = await submitInternals.createThrottleKey("203.0.113.20", "secret");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => submitInternals.updateRateLimit(env.DB, key)),
    );
    expect(results.filter((result) => !result.blocked)).toHaveLength(3);
    expect(results.filter((result) => result.blocked)).toHaveLength(1);
  });

  it("does not write when Turnstile hostname validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      hostname: "attacker.example",
      action: "survey_submit",
    })));
    const response = await handleSubmit(request(), submitEnv());
    expect(response.status).toBe(400);
    const count = await env.DB.prepare("SELECT count(*) AS count FROM survey_responses").first();
    expect(count.count).toBe(0);
  });
});
