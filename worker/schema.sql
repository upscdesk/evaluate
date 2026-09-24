-- One row per person. The email is the identity; there is no password.
CREATE TABLE IF NOT EXISTS people (
  email       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  last_seen   TEXT
);

-- A six digit code, stored as a hash so the table is not a list of live codes.
CREATE TABLE IF NOT EXISTS codes (
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (email, code_hash)
);

-- One row per evaluation, which is also the month's usage count.
CREATE TABLE IF NOT EXISTS evaluations (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  desk        TEXT NOT NULL,
  paper       TEXT,
  marks       INTEGER,
  score       REAL,
  month       TEXT NOT NULL,          -- YYYY-MM in IST, the month an allowance belongs to
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evaluations_by_month ON evaluations (email, month);
