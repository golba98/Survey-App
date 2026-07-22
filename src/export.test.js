import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { handleExport } = await import("./export.js");

function makeDb(rows = []) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _bindings: [],
        bind(...args) {
          this._bindings = args;
          return this;
        },
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

function makeEnv(rows = []) {
  return {
    DB: makeDb(rows),
    EXPORT_TOKEN: "export-secret",
  };
}

function makeRequest(path = "/export", headers = {}) {
  return new Request(`http://localhost:8787${path}`, {
    method: "GET",
    headers,
  });
}

const ROWS = [
  {
    id: 1,
    timestamp: "2026-06-20 10:00:00",
    age_range: "22-25",
    status: "Student",
    main_pressure: "Rent",
    cost_increased: "Yes",
    cut_back_on: '["Eating out","Data"]',
    work_worry_rating: 4,
    income_keeps_up_rating: 2,
    transport_cost: "R301-R600",
    food_cost: "R501-R1000",
    comment: "=IMPORTXML(\"https://example.com\")",
  },
];

describe("handleExport", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const res = await handleExport(makeRequest(), makeEnv(ROWS));
    assert.equal(res.status, 401);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    const res = await handleExport(
      makeRequest("/export", { Authorization: "Bearer wrong-token" }),
      makeEnv(ROWS),
    );
    assert.equal(res.status, 401);
  });

  it("returns 401 when a query-string token is used", async () => {
    const res = await handleExport(
      makeRequest("/export?token=export-secret", { Authorization: "Bearer export-secret" }),
      makeEnv(ROWS),
    );
    assert.equal(res.status, 401);
  });

  it("returns JSON when the bearer token is correct", async () => {
    const res = await handleExport(
      makeRequest("/export?format=json", { Authorization: "Bearer export-secret" }),
      makeEnv(ROWS),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.deepEqual(body[0].cut_back_on, ["Eating out", "Data"]);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("rejects invalid or reversed date ranges", async () => {
    const headers = { Authorization: "Bearer export-secret" };
    assert.equal((await handleExport(makeRequest("/export?start=2026-99-99", headers), makeEnv(ROWS))).status, 400);
    assert.equal((await handleExport(makeRequest("/export?start=2026-07-22&end=2026-07-01", headers), makeEnv(ROWS))).status, 400);
  });

  it("escapes CSV formula-leading cells", async () => {
    const res = await handleExport(
      makeRequest("/export?format=csv", { Authorization: "Bearer export-secret" }),
      makeEnv(ROWS),
    );
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.match(csv, /"'=IMPORTXML\(""https:\/\/example\.com""\)"/);
  });

  it("escapes formula cells even when whitespace precedes the formula", async () => {
    const rows = [{ ...ROWS[0], comment: "\t=2+2" }];
    const res = await handleExport(
      makeRequest("/export?format=csv", { Authorization: "Bearer export-secret" }),
      makeEnv(rows),
    );
    assert.match(await res.text(), /'\t=2\+2/);
  });
});
