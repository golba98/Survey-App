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
});
