import {
  jsonResponse,
  optionsResponse,
  rejectDisallowedOrigin,
  serverError,
  serviceUnavailable,
  textResponse,
} from "./security.js";

const EXPORT_COLUMNS = [
  "id",
  "timestamp",
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

export async function handleExport(request, env) {
  const allowCors = false;

  if (request.method === "OPTIONS") {
    return optionsResponse(request, env, ["GET", "OPTIONS"], allowCors);
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed. Use GET /export." }, 405, {
      request,
      env,
      allowCors,
      extraHeaders: { Allow: "GET, OPTIONS" },
    });
  }

  const originRejection = rejectDisallowedOrigin(request, env, allowCors);
  if (originRejection) {
    return originRejection;
  }

  if (!env.DB) {
    return serviceUnavailable("Missing D1 binding for export handler.", request, env, { allowCors });
  }

  if (!env.EXPORT_TOKEN) {
    return serviceUnavailable("Missing EXPORT_TOKEN for export handler.", request, env, { allowCors });
  }

  try {
    const url = new URL(request.url);
    const providedToken = url.searchParams.get("token");

    if (!providedToken || providedToken !== env.EXPORT_TOKEN) {
      return jsonResponse({ error: "Unauthorized." }, 401, {
        request,
        env,
        allowCors,
      });
    }

    const format = url.searchParams.get("format") || "json";
    if (!["json", "csv"].includes(format)) {
      return jsonResponse({ error: "format must be either json or csv." }, 400, {
        request,
        env,
        allowCors,
      });
    }

    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if ((start && !isIsoDate(start)) || (end && !isIsoDate(end))) {
      return jsonResponse({ error: "start and end must use YYYY-MM-DD format." }, 400, {
        request,
        env,
        allowCors,
      });
    }

    const statement = buildExportStatement(env.DB, start, end);
    const result = await statement.all();
    const rows = (result.results || []).map(formatRow);

    if (format === "csv") {
      return textResponse(toCsv(rows), 200, {
        request,
        env,
        allowCors,
        extraHeaders: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="survey-export.csv"',
        },
      });
    }

    return jsonResponse(rows, 200, { request, env, allowCors });
  } catch (error) {
    return serverError("Export handler failed.", error, request, env, { allowCors });
  }
}

function buildExportStatement(db, start, end) {
  if (start) {
    if (end) {
      return db.prepare(
        `SELECT ${EXPORT_COLUMNS.join(", ")}
         FROM survey_responses
         WHERE date(timestamp) >= date(?)
           AND date(timestamp) <= date(?)
         ORDER BY timestamp DESC`,
      ).bind(start, end);
    }

    return db.prepare(
      `SELECT ${EXPORT_COLUMNS.join(", ")}
       FROM survey_responses
       WHERE date(timestamp) >= date(?)
       ORDER BY timestamp DESC`,
    ).bind(start);
  }

  if (end) {
    return db.prepare(
      `SELECT ${EXPORT_COLUMNS.join(", ")}
       FROM survey_responses
       WHERE date(timestamp) <= date(?)
       ORDER BY timestamp DESC`,
    ).bind(end);
  }

  return db.prepare(
    `SELECT ${EXPORT_COLUMNS.join(", ")}
     FROM survey_responses
     ORDER BY timestamp DESC`,
  );
}

function formatRow(row) {
  return {
    ...row,
    cut_back_on: parseCutBackOn(row.cut_back_on),
  };
}

function parseCutBackOn(value) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCsv(rows) {
  if (rows.length === 0) {
    return `${EXPORT_COLUMNS.join(",")}\n`;
  }

  const csvRows = [EXPORT_COLUMNS.join(",")];

  for (const row of rows) {
    const values = EXPORT_COLUMNS.map((column) => {
      const value = column === "cut_back_on" ? row[column].join("; ") : row[column];
      return escapeCsvValue(value);
    });

    csvRows.push(values.join(","));
  }

  return `${csvRows.join("\n")}\n`;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
