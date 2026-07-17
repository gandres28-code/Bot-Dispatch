BEGIN;

CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  notion_id TEXT UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  code TEXT,
  role TEXT NOT NULL DEFAULT '',
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'notion',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_code_unique
ON employees (code)
WHERE code IS NOT NULL AND code <> '';

CREATE INDEX IF NOT EXISTS employees_normalized_name_idx
ON employees (normalized_name);

CREATE INDEX IF NOT EXISTS employees_active_idx
ON employees (active);

CREATE TABLE IF NOT EXISTS rooms (
  id BIGSERIAL PRIMARY KEY,
  notion_id TEXT UNIQUE,
  work_date DATE NOT NULL,
  room_number TEXT NOT NULL,
  normalized_room TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT 'OTHER',
  cleaning_status TEXT NOT NULL DEFAULT '',
  guest_out BOOLEAN NOT NULL DEFAULT FALSE,
  guest_out_at TIMESTAMPTZ,
  urgent BOOLEAN NOT NULL DEFAULT FALSE,
  arrival BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_cleaner TEXT NOT NULL DEFAULT '',
  assigned_cleaners JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_inspector TEXT NOT NULL DEFAULT '',
  assigned_inspectors JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  inspection_started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'notion',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_date, normalized_room)
);

CREATE INDEX IF NOT EXISTS rooms_work_date_idx
ON rooms (work_date);

CREATE INDEX IF NOT EXISTS rooms_status_idx
ON rooms (work_date, cleaning_status);

CREATE INDEX IF NOT EXISTS rooms_guest_out_idx
ON rooms (work_date, guest_out);

CREATE INDEX IF NOT EXISTS rooms_urgent_idx
ON rooms (work_date, urgent);

CREATE TABLE IF NOT EXISTS assignments (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  unit TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  normalized_employee TEXT NOT NULL,
  assignment_role TEXT NOT NULL,
  split_percent NUMERIC(7,4) NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assignments_employee_date_idx
ON assignments (normalized_employee, work_date);

CREATE INDEX IF NOT EXISTS assignments_room_idx
ON assignments (room_id);

CREATE TABLE IF NOT EXISTS operations_logs (
  id BIGSERIAL PRIMARY KEY,
  notion_id TEXT UNIQUE,
  external_event_id TEXT,
  work_date DATE NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unit TEXT NOT NULL DEFAULT '',
  normalized_room TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  cleaner TEXT NOT NULL DEFAULT '',
  inspector TEXT NOT NULL DEFAULT '',
  employee TEXT NOT NULL DEFAULT '',
  role_worked TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Other',
  priority TEXT NOT NULL DEFAULT 'Normal',
  source TEXT NOT NULL DEFAULT '417-maid',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_logs_external_event_unique
ON operations_logs (external_event_id)
WHERE external_event_id IS NOT NULL AND external_event_id <> '';

CREATE INDEX IF NOT EXISTS operations_logs_date_idx
ON operations_logs (work_date, event_time DESC);

CREATE INDEX IF NOT EXISTS operations_logs_unit_idx
ON operations_logs (work_date, normalized_room);

CREATE INDEX IF NOT EXISTS operations_logs_employee_idx
ON operations_logs (work_date, employee);

CREATE TABLE IF NOT EXISTS payroll_records (
  id BIGSERIAL PRIMARY KEY,
  notion_id TEXT UNIQUE,
  work_date DATE NOT NULL,
  employee TEXT NOT NULL,
  normalized_employee TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  room_type TEXT NOT NULL DEFAULT '',
  gross_unit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  split_count INTEGER NOT NULL DEFAULT 1 CHECK (split_count > 0),
  split_percent NUMERIC(7,4) NOT NULL DEFAULT 1,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'unit',
  role_worked TEXT NOT NULL DEFAULT 'Cleaner',
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  source TEXT NOT NULL DEFAULT 'notion',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_date, normalized_employee, unit, pay_type, role_worked)
);

CREATE INDEX IF NOT EXISTS payroll_records_week_idx
ON payroll_records (week_start, week_end);

CREATE INDEX IF NOT EXISTS payroll_records_employee_idx
ON payroll_records (normalized_employee, work_date);

CREATE TABLE IF NOT EXISTS time_clock_records (
  id BIGSERIAL PRIMARY KEY,
  notion_id TEXT UNIQUE,
  employee TEXT NOT NULL,
  normalized_employee TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  role_worked TEXT NOT NULL DEFAULT '',
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  break_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Open',
  source TEXT NOT NULL DEFAULT 'notion',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_clock_employee_idx
ON time_clock_records (normalized_employee, clock_in);

CREATE INDEX IF NOT EXISTS time_clock_status_idx
ON time_clock_records (status);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  employee TEXT NOT NULL DEFAULT '',
  normalized_employee TEXT NOT NULL DEFAULT '',
  notification_type TEXT NOT NULL DEFAULT 'GENERAL',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Normal',
  read_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT '417-maid',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_employee_idx
ON notifications (normalized_employee, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
ON notifications (normalized_employee, read_at)
WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_status (
  id BIGSERIAL PRIMARY KEY,
  sync_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  last_cursor TEXT,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  records_processed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (migration_name)
VALUES ('001_initial_417_maid_schema')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;

BEGIN;

ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS property_name TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS adjustment_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS adjusted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payroll_rates (
  id BIGSERIAL PRIMARY KEY,
  property_name TEXT NOT NULL DEFAULT 'ALL',
  room_type TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT 'Admin',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_name, room_type, effective_from)
);

CREATE INDEX IF NOT EXISTS payroll_rates_lookup_idx
ON payroll_rates (property_name, room_type, effective_from DESC)
WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS payroll_weeks (
  id BIGSERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  snapshot_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  snapshot_records INTEGER NOT NULL DEFAULT 0,
  snapshot_employees INTEGER NOT NULL DEFAULT 0,
  snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_at TIMESTAMPTZ,
  closed_by TEXT NOT NULL DEFAULT '',
  close_reason TEXT NOT NULL DEFAULT '',
  reopened_at TIMESTAMPTZ,
  reopened_by TEXT NOT NULL DEFAULT '',
  reopen_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (week_start, week_end)
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id BIGSERIAL PRIMARY KEY,
  payroll_record_id BIGINT REFERENCES payroll_records(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  employee TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  original_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  new_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_audit (
  id BIGSERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  action TEXT NOT NULL,
  employee TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  payroll_record_id BIGINT,
  changed_by TEXT NOT NULL DEFAULT 'Admin',
  reason TEXT NOT NULL DEFAULT '',
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_audit_week_idx
ON payroll_audit (week_start, week_end, created_at DESC);

INSERT INTO payroll_rates (property_name, room_type, amount, effective_from, created_by, reason)
VALUES
  ('ALL','3',55,'2026-01-01','System','Initial default rate'),
  ('ALL','2',45,'2026-01-01','System','Initial default rate'),
  ('ALL','1',35,'2026-01-01','System','Initial default rate'),
  ('ALL','M',20,'2026-01-01','System','Initial default rate'),
  ('ALL','S',22,'2026-01-01','System','Initial default rate'),
  ('ALL','SUITE',20,'2026-01-01','System','Initial default rate')
ON CONFLICT (property_name, room_type, effective_from) DO NOTHING;

INSERT INTO schema_migrations (migration_name)
VALUES ('002_payroll_2_complete')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
