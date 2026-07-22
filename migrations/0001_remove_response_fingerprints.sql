-- Remove response-linked network/browser fingerprints while preserving survey data.
CREATE TABLE survey_responses_private (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    age_range TEXT NOT NULL CHECK (age_range IN ('18-21', '22-25', '26-30', '31+')),
    status TEXT NOT NULL CHECK (status IN ('Student', 'Employed', 'Unemployed', 'Studying and working')),
    main_pressure TEXT NOT NULL CHECK (main_pressure IN ('Food', 'Transport', 'Rent', 'Electricity', 'Data', 'Tuition', 'Debt')),
    cost_increased TEXT NOT NULL CHECK (cost_increased IN ('Yes', 'No', 'Not sure')),
    cut_back_on TEXT NOT NULL CHECK (json_valid(cut_back_on) AND json_type(cut_back_on) = 'array'),
    work_worry_rating INTEGER NOT NULL CHECK (work_worry_rating BETWEEN 1 AND 5),
    income_keeps_up_rating INTEGER NOT NULL CHECK (income_keeps_up_rating BETWEEN 1 AND 5),
    transport_cost TEXT NOT NULL CHECK (transport_cost IN ('R0-R300', 'R301-R600', 'R601-R1000', 'R1001-R1500', 'R1500+')),
    food_cost TEXT NOT NULL CHECK (food_cost IN ('R0-R500', 'R501-R1000', 'R1001-R2000', 'R2001-R3000', 'R3000+')),
    comment TEXT CHECK (comment IS NULL OR length(comment) <= 500)
);

INSERT INTO survey_responses_private (
    id, timestamp, age_range, status, main_pressure, cost_increased, cut_back_on,
    work_worry_rating, income_keeps_up_rating, transport_cost, food_cost, comment
)
SELECT
    id, timestamp, age_range, status, main_pressure, cost_increased, cut_back_on,
    work_worry_rating, income_keeps_up_rating, transport_cost, food_cost, comment
FROM survey_responses;

DROP INDEX IF EXISTS idx_survey_responses_duplicate_guard;
DROP INDEX IF EXISTS idx_survey_responses_timestamp;
DROP TABLE survey_responses;
ALTER TABLE survey_responses_private RENAME TO survey_responses;
CREATE INDEX idx_survey_responses_timestamp ON survey_responses(timestamp);
CREATE INDEX IF NOT EXISTS idx_submission_throttle_last_seen
    ON submission_throttle(last_seen_at);
