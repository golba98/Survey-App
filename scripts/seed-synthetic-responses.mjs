#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DATABASE_NAME = "25-survey-app-db";
const DEFAULT_COUNT = 40;
const MIN_COUNT = 1;
const MAX_COUNT = 250;

const OPTIONS = {
  age_range: ["18-21", "22-25", "26-30", "31+"],
  status: ["Student", "Employed", "Unemployed", "Studying and working"],
  main_pressure: ["Food", "Transport", "Rent", "Electricity", "Data", "Tuition", "Debt"],
  cost_increased: ["Yes", "No", "Not sure"],
  cut_back_on: ["Eating out", "Meat", "Transport", "Subscriptions", "Clothing", "Social life", "Data"],
  transport_cost: ["R0-R300", "R301-R600", "R601-R1000", "R1001-R1500", "R1500+"],
  food_cost: ["R0-R500", "R501-R1000", "R1001-R2000", "R2001-R3000", "R3000+"],
};

const COMMENTS = [
  null,
  "Food prices and transport costs make it harder to keep a steady monthly budget.",
  "I mostly reduce social spending when prices go up.",
  "Data, food, and transport are the costs I notice most during the month.",
  "Income has not really kept up with daily expenses.",
  "I try to buy cheaper groceries and travel less when possible.",
  "Rent and electricity leave less money for food and study needs.",
  "Work uncertainty makes it difficult to plan ahead financially.",
  "I have cut back on eating out and subscriptions to manage expenses.",
  "Transport costs affect how often I can attend activities away from home.",
];

const STATUS_WEIGHTS = [
  ["Student", 45],
  ["Studying and working", 25],
  ["Employed", 20],
  ["Unemployed", 10],
];

const PRESSURE_BY_STATUS = {
  Student: ["Food", "Transport", "Data", "Tuition", "Rent"],
  "Studying and working": ["Food", "Transport", "Rent", "Data", "Debt"],
  Employed: ["Rent", "Food", "Transport", "Debt", "Electricity"],
  Unemployed: ["Food", "Transport", "Data", "Debt", "Rent"],
};

const args = parseArgs(process.argv.slice(2));
const count = parseCount(args.count);
const mode = args.apply ? "apply" : "dry-run";
const target = args.local ? "local" : "remote";
const runId = args["run-id"] || new Date().toISOString().replace(/[:.]/g, "-");
const sql = buildSeedSql(count, runId);

if (mode === "dry-run") {
  process.stdout.write(sql);
  process.stderr.write(`\nGenerated ${count} synthetic survey row(s). Dry run only; no database changes were made.\n`);
} else {
  applySql(sql, count, target);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (arg === "--local") {
      parsed.local = true;
      continue;
    }

    if (arg === "--remote") {
      parsed.remote = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith("--count=")) {
      parsed.count = arg.slice("--count=".length);
      continue;
    }

    if (arg === "--count") {
      parsed.count = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--run-id=")) {
      parsed["run-id"] = arg.slice("--run-id=".length);
      continue;
    }

    if (arg === "--run-id") {
      parsed["run-id"] = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parseCount(value) {
  if (value === undefined) {
    return DEFAULT_COUNT;
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new Error(`--count must be an integer from ${MIN_COUNT} to ${MAX_COUNT}.`);
  }

  return count;
}

function buildSeedSql(count, runId) {
  const rows = Array.from({ length: count }, (_, index) => buildRow(index, runId));

  return [
    "-- Synthetic anonymous survey seed data.",
    `-- Run ID: ${runId}`,
    `-- Rows: ${count}`,
    ...rows.map(toInsertStatement),
    "",
  ].join("\n");
}

function buildRow(index, runId) {
  const status = weightedPick(STATUS_WEIGHTS, index);
  const ageRange = pickAgeRange(status, index);
  const mainPressure = pick(PRESSURE_BY_STATUS[status], index + 2);
  const workWorryRating = clampRating(status === "Unemployed" ? 4 + (index % 2) : 2 + (index % 4));
  const incomeKeepsUpRating = clampRating(5 - Math.max(workWorryRating - 1, index % 5));
  const cutBackOn = pickCutBackOptions(mainPressure, index);

  return {
    age_range: ageRange,
    status,
    main_pressure: mainPressure,
    cost_increased: pickCostIncrease(index),
    cut_back_on: JSON.stringify(cutBackOn),
    work_worry_rating: workWorryRating,
    income_keeps_up_rating: incomeKeepsUpRating,
    transport_cost: pickTransportCost(status, index),
    food_cost: pickFoodCost(status, index),
    comment: COMMENTS[index % COMMENTS.length],
  };
}

function pickAgeRange(status, index) {
  if (status === "Student") {
    return pick(["18-21", "18-21", "22-25", "22-25", "26-30"], index);
  }

  if (status === "Studying and working") {
    return pick(["18-21", "22-25", "22-25", "26-30", "31+"], index);
  }

  return pick(OPTIONS.age_range, index + 1);
}

function pickCostIncrease(index) {
  return pick(["Yes", "Yes", "Yes", "Yes", "Not sure", "No"], index);
}

function pickTransportCost(status, index) {
  if (status === "Student") {
    return pick(["R0-R300", "R301-R600", "R301-R600", "R601-R1000", "R1001-R1500"], index);
  }

  return pick(OPTIONS.transport_cost, index + 2);
}

function pickFoodCost(status, index) {
  if (status === "Student") {
    return pick(["R501-R1000", "R501-R1000", "R1001-R2000", "R1001-R2000", "R2001-R3000"], index);
  }

  return pick(["R501-R1000", "R1001-R2000", "R1001-R2000", "R2001-R3000", "R3000+"], index + 1);
}

function pickCutBackOptions(mainPressure, index) {
  const firstChoice = mainPressure === "Food" ? "Meat" : mainPressure;
  const normalizedFirstChoice = OPTIONS.cut_back_on.includes(firstChoice) ? firstChoice : "Eating out";
  const optionCount = 1 + (index % 3);
  const selected = new Set([normalizedFirstChoice]);

  for (let offset = 0; selected.size < optionCount; offset += 1) {
    selected.add(pick(OPTIONS.cut_back_on, index + offset + 1));
  }

  return Array.from(selected);
}

function weightedPick(weightedValues, index) {
  const total = weightedValues.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = (index * 37) % total;

  for (const [value, weight] of weightedValues) {
    if (cursor < weight) {
      return value;
    }
    cursor -= weight;
  }

  return weightedValues[0][0];
}

function pick(values, index) {
  return values[index % values.length];
}

function clampRating(value) {
  return Math.max(1, Math.min(5, value));
}

function toInsertStatement(row) {
  const columns = [
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

  const values = columns.map((column) => sqlValue(row[column]));
  return `INSERT INTO survey_responses (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function applySql(sql, count, target = "remote") {
  const sqlPath = join(tmpdir(), `survey-synthetic-seed-${randomUUID()}.sql`);
  writeFileSync(sqlPath, sql, "utf8");

  const dbTarget = target === "local" ? "DB" : DATABASE_NAME;
  const targetFlag = target === "local" ? "--local" : "--remote";

  try {
    const result = spawnSync(
      "npx",
      ["wrangler", "d1", "execute", dbTarget, targetFlag, "--file", sqlPath],
      { encoding: "utf8", stdio: "inherit" },
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    process.stderr.write(`Inserted ${count} synthetic survey row(s) into ${dbTarget} (${target}).\n`);
  } finally {
    unlinkSync(sqlPath);
  }
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/seed-synthetic-responses.mjs [options]

Options:
  --count <number>  Number of rows to generate. Default: ${DEFAULT_COUNT}
  --run-id <value>  Identifier included in the generated SQL header.
  --apply          Apply the generated SQL to Cloudflare D1.
  --local          Apply to local D1 instance (default if omitted is remote when --apply is used).
  --remote         Apply to remote D1 instance (default).
  --help           Show this help text.

Without --apply, the script prints SQL and makes no database changes.
`);
}
