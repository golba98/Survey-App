import { createHash, timingSafeEqual } from "node:crypto";
import {
  jsonResponse,
  rejectCrossOrigin,
  responseHeaders,
  serverError,
  serviceUnavailable,
} from "./security.js";

const EXPORT_COLUMNS = [
  "id", "timestamp", "age_range", "status", "main_pressure", "cost_increased",
  "cut_back_on", "work_worry_rating", "income_keeps_up_rating", "transport_cost",
  "food_cost", "comment",
];
const EXPORT_PAGE_SIZE = 500;

export async function handleExport(request, env) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405, {
      request,
      extraHeaders: { Allow: "GET" },
    });
  }

  const originRejection = rejectCrossOrigin(request);
  if (originRejection) return originRejection;

  if (!env.DB || !env.EXPORT_TOKEN) {
    return serviceUnavailable("export_missing_binding_or_secret", request);
  }

  try {
    const url = new URL(request.url);
    if (url.searchParams.has("token") || !(await isAuthorizedExportRequest(request, env.EXPORT_TOKEN))) {
      return jsonResponse({ error: "Unauthorized." }, 401, {
        request,
        extraHeaders: { "WWW-Authenticate": "Bearer" },
      });
    }

    const format = url.searchParams.get("format") || "json";
    if (!new Set(["json", "csv"]).has(format)) {
      return jsonResponse({ error: "format must be either json or csv." }, 400, { request });
    }

    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if ((start && !isIsoDate(start)) || (end && !isIsoDate(end)) || (start && end && start > end)) {
      return jsonResponse({ error: "start and end must be valid YYYY-MM-DD dates in order." }, 400, { request });
    }

    return createExportResponse(request, env.DB, { format, start, end });
  } catch (error) {
    return serverError("export_handler_failed", error, request);
  }
}

async function isAuthorizedExportRequest(request, expectedToken) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const providedToken = authorization.slice("Bearer ".length).trim();
  if (!providedToken) return false;

  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  const providedDigest = createHash("sha256").update(providedToken).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

function createExportResponse(request, db, filters) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let offset = 0;
        let firstJsonRow = true;
        controller.enqueue(encoder.encode(filters.format === "csv" ? `${EXPORT_COLUMNS.join(",")}\n` : "["));

        while (true) {
          const result = await buildExportStatement(db, filters.start, filters.end, offset).all();
          const rows = result.results || [];
          for (const rawRow of rows) {
            const row = formatRow(rawRow);
            if (filters.format === "csv") {
              controller.enqueue(encoder.encode(`${toCsvRow(row)}\n`));
            } else {
              controller.enqueue(encoder.encode(`${firstJsonRow ? "" : ","}${JSON.stringify(row)}`));
              firstJsonRow = false;
            }
          }

          if (rows.length < EXPORT_PAGE_SIZE) break;
          offset += rows.length;
        }

        if (filters.format === "json") controller.enqueue(encoder.encode("]"));
        controller.close();
      } catch (error) {
        console.error(JSON.stringify({
          event: "export_stream_failed",
          errorType: error instanceof Error ? error.name : typeof error,
        }));
        controller.error(error);
      }
    },
  });

  const isCsv = filters.format === "csv";
  const headers = responseHeaders(request, "api", {
    "Cache-Control": "no-store",
    "Content-Type": isCsv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    ...(isCsv ? { "Content-Disposition": 'attachment; filename="survey-export.csv"' } : {}),
  });
  return new Response(stream, { status: 200, headers });
}

function buildExportStatement(db, start, end, offset) {
  const filters = [];
  const bindings = [];
  if (start) {
    filters.push("date(timestamp) >= date(?)");
    bindings.push(start);
  }
  if (end) {
    filters.push("date(timestamp) <= date(?)");
    bindings.push(end);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db.prepare(
    `SELECT ${EXPORT_COLUMNS.join(", ")}
     FROM survey_responses
     ${where}
     ORDER BY timestamp DESC, id DESC
     LIMIT ? OFFSET ?`,
  ).bind(...bindings, EXPORT_PAGE_SIZE, offset);
}

function formatRow(row) {
  return { ...row, cut_back_on: parseCutBackOn(row.cut_back_on) };
}

function parseCutBackOn(value) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCsvRow(row) {
  return EXPORT_COLUMNS.map((column) => {
    const value = column === "cut_back_on" ? row[column].join("; ") : row[column];
    return escapeCsvValue(value);
  }).join(",");
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  let stringValue = String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(stringValue)) stringValue = `'${stringValue}`;
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export const exportInternals = { escapeCsvValue, isAuthorizedExportRequest, isIsoDate };
