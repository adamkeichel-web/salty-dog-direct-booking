CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  property_slug TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  guests INTEGER NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','expired','cancelled','refunded')),
  stripe_session_id TEXT UNIQUE,
  amount_total INTEGER,
  currency TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_property_dates
ON bookings(property_slug, checkin, checkout, status, expires_at);
