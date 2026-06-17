-- Cloudflare D1 schema for the 25-survey-app project
-- Stores anonymous survey responses for a student data visualisation project.

-- Create the survey responses table
CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    age_range TEXT NOT NULL CHECK (age_range IN ('18-21', '22-25', '26-30', '31+')),
    status TEXT NOT NULL CHECK (status IN ('Student', 'Employed', 'Unemployed', 'Studying and working')),
    main_pressure TEXT NOT NULL CHECK (main_pressure IN ('Food', 'Transport', 'Rent', 'Electricity', 'Data', 'Tuition', 'Debt')),
    cost_increased TEXT NOT NULL CHECK (cost_increased IN ('Yes', 'No', 'Not sure')),
    cut_back_on TEXT NOT NULL,
    work_worry_rating INTEGER NOT NULL CHECK (work_worry_rating BETWEEN 1 AND 5),
    income_keeps_up_rating INTEGER NOT NULL CHECK (income_keeps_up_rating BETWEEN 1 AND 5),
    transport_cost TEXT NOT NULL CHECK (transport_cost IN ('R0-R300', 'R301-R600', 'R601-R1000', 'R1001-R1500', 'R1500+')),
    food_cost TEXT NOT NULL CHECK (food_cost IN ('R0-R500', 'R501-R1000', 'R1001-R2000', 'R2001-R3000', 'R3000+')),
    comment TEXT,
    ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_timestamp ON survey_responses(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_responses_ip_hash ON survey_responses(ip_hash);
