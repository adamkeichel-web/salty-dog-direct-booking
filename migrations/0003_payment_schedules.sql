ALTER TABLE bookings ADD COLUMN payment_plan TEXT NOT NULL DEFAULT 'full';
ALTER TABLE bookings ADD COLUMN booking_total INTEGER;
ALTER TABLE bookings ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN balance_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN balance_due_at TEXT;
ALTER TABLE bookings ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE bookings ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE bookings ADD COLUMN balance_payment_intent_id TEXT;
ALTER TABLE bookings ADD COLUMN balance_status TEXT NOT NULL DEFAULT 'not_due';
ALTER TABLE bookings ADD COLUMN balance_paid_at TEXT;
ALTER TABLE bookings ADD COLUMN agreement_version TEXT;
ALTER TABLE bookings ADD COLUMN agreement_accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_balance_due
ON bookings(payment_plan, balance_status, balance_due_at);
