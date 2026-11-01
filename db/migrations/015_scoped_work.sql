BEGIN;
SELECT pg_advisory_xact_lock(150015);
ALTER TABLE care_locations ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION CHECK(latitude BETWEEN -90 AND 90);
ALTER TABLE care_locations ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION CHECK(longitude BETWEEN -180 AND 180);
ALTER TABLE care_locations ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 100 CHECK(radius_m BETWEEN 20 AND 2000);
ALTER TABLE care_locations ADD COLUMN IF NOT EXISTS geofence_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS care_work_jobs (
 id UUID PRIMARY KEY, unit_id UUID NOT NULL REFERENCES care_units(id), work_date DATE NOT NULL,
 service_type TEXT NOT NULL CHECK(service_type IN ('regular','deep','touch_up')),
 cleaner_ids JSONB NOT NULL, cleaner_names JSONB NOT NULL, inspector_id TEXT NOT NULL DEFAULT '', inspector_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cleaning','awaiting_inspection','inspecting','ready','cancelled')),
 instructions TEXT NOT NULL DEFAULT '', cleaner_pay_cents INTEGER CHECK(cleaner_pay_cents BETWEEN 0 AND 10000000),
 inspector_pay_cents INTEGER CHECK(inspector_pay_cents BETWEEN 0 AND 10000000),
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, inspection_started_at TIMESTAMPTZ, ready_at TIMESTAMPTZ,
 checklist JSONB, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(unit_id,work_date)
);
CREATE TABLE IF NOT EXISTS care_work_events (
 request_id UUID PRIMARY KEY, job_id UUID NOT NULL REFERENCES care_work_jobs(id), action TEXT NOT NULL, actor_id TEXT NOT NULL, actor TEXT NOT NULL,
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS care_work_reports (
 id UUID PRIMARY KEY, job_id UUID NOT NULL REFERENCES care_work_jobs(id), kind TEXT NOT NULL CHECK(kind IN ('issue','supplies')),
 note TEXT NOT NULL, actor_id TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 resolved_by TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS care_work_photos (
 id UUID PRIMARY KEY, job_id UUID NOT NULL REFERENCES care_work_jobs(id), actor_id TEXT NOT NULL, public_id TEXT UNIQUE NOT NULL,
 area TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS care_clock_sessions (
 id UUID PRIMARY KEY, employee_id TEXT NOT NULL, employee TEXT NOT NULL, employee_code TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT '', location_id UUID REFERENCES care_locations(id), work_location TEXT NOT NULL,
 clock_in TIMESTAMPTZ NOT NULL, clock_out TIMESTAMPTZ, rate_cents INTEGER NOT NULL CHECK(rate_cents BETWEEN 0 AND 10000000),
 in_gps JSONB NOT NULL, out_gps JSONB, in_request UUID UNIQUE NOT NULL, out_request UUID UNIQUE,
 notion_page_id TEXT UNIQUE, mirror_version INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 mirror_error TEXT NOT NULL DEFAULT '', mirror_next_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 rate_note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(clock_out IS NULL OR clock_out>=clock_in)
);
ALTER TABLE care_clock_sessions ADD COLUMN IF NOT EXISTS pay_mode TEXT NOT NULL DEFAULT 'hourly' CHECK(pay_mode IN ('hourly','attendance'));
CREATE UNIQUE INDEX IF NOT EXISTS care_clock_one_open ON care_clock_sessions(employee_id) WHERE clock_out IS NULL;
CREATE INDEX IF NOT EXISTS care_clock_interval_idx ON care_clock_sessions(clock_in,clock_out);
CREATE TABLE IF NOT EXISTS care_work_presence (
 employee_id TEXT PRIMARY KEY, session_id UUID NOT NULL REFERENCES care_clock_sessions(id), employee TEXT NOT NULL,
 lat DOUBLE PRECISION, lng DOUBLE PRECISION, accuracy DOUBLE PRECISION, location_id UUID REFERENCES care_locations(id),
 captured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sharing BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO schema_migrations(migration_name) VALUES ('015_scoped_work') ON CONFLICT(migration_name) DO NOTHING;
COMMIT;
