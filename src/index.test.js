import { describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

function env(overrides = {}) {
  return {
    TURNSTILE_SITE_KEY: "public-test-key",
    TURNSTILE_ACTION: "survey_submit",
    ASSETS: {
      async fetch() {
        return new Response("asset", { headers: { "Content-Type": "text/html" } });
      },
    },
    ...overrides,
  };
}

describe("Worker router security", () => {
  it("redirects public HTTP requests to HTTPS", async () => {
    const response = await worker.fetch(new Request("http://surveyapp.ink/"), env());
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://surveyapp.ink/");
  });

  it("allows HTTP for local development", async () => {
    const response = await worker.fetch(new Request("http://localhost:8787/"), env());
    assert.equal(response.status, 200);
  });

  it("serves public Turnstile configuration without caching", async () => {
    const response = await worker.fetch(new Request("https://surveyapp.ink/config"), env());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      turnstileSiteKey: "public-test-key",
      turnstileAction: "survey_submit",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("fails closed when the public site key is missing", async () => {
    const response = await worker.fetch(
      new Request("https://surveyapp.ink/config"),
      env({ TURNSTILE_SITE_KEY: undefined }),
    );
    assert.equal(response.status, 503);
  });

  it("adds strict static security headers", async () => {
    const response = await worker.fetch(new Request("https://surveyapp.ink/"), env());
    assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.doesNotMatch(response.headers.get("content-security-policy"), /unsafe-inline/);
  });

  it("keeps documents same-origin but lets social crawlers fetch preview images", async () => {
    const document = await worker.fetch(new Request("https://surveyapp.ink/"), env());
    assert.equal(document.headers.get("cross-origin-resource-policy"), "same-origin");

    const image = await worker.fetch(
      new Request("https://surveyapp.ink/assets/social/og-image.png"),
      env({
        ASSETS: {
          async fetch() {
            return new Response("png", { headers: { "Content-Type": "image/png" } });
          },
        },
      }),
    );
    assert.equal(image.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  });
});
