const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

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

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "GET, OPTIONS",
      },
    });
  }

  if (request.method !== "GET") {
    return json(
      { error: "Method not allowed. Use GET /export." },
      405,
      { Allow: "GET, OPTIONS" },
    );
  }

  if (!env.DB) {
    return json({ error: "D1 binding DB is not configured." }, 500);
  }

  if (!env.EXPORT_TOKEN) {
    return json({ error: "Missing EXPORT_TOKEN secret." }, 500);
  }

  const url = new URL(request.url);
  const providedToken = url.searchParams.get("token");

  if (!providedToken || providedToken !== env.EXPORT_TOKEN) {
    return json({ error: "Unauthorized." }, 401);
  }

  const format = url.searchParams.get("format") || "json";
  if (!["json", "csv"].includes(format)) {
    return json({ error: "format must be either json or csv." }, 400);
  }

  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if ((start && !isIsoDate(start)) || (end && !isIsoDate(end))) {
    return json({ error: "start and end must use YYYY-MM-DD format." }, 400);
  }

  const { query, bindings } = buildExportQuery(start, end);
  const result = await env.DB.prepare(query).bind(...bindings).all();
  const rows = (result.results || []).map(formatRow);

  if (format === "csv") {
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="survey-export.csv"',
      },
    });
  }

  return json(rows, 200);
}

function buildExportQuery(start, end) {
  const conditions = [];
  const bindings = [];

  if (start) {
    conditions.push("date(timestamp) >= date(?)");
    bindings.push(start);
  }

  if (end) {
    conditions.push("date(timestamp) <= date(?)");
    bindings.push(end);
  }

  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT ${EXPORT_COLUMNS.join(", ")} FROM survey_responses${whereClause} ORDER BY timestamp DESC`;

  return { query, bindings };
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

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}
