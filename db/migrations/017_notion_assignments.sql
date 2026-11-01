BEGIN;
SELECT pg_advisory_xact_lock(170017);
ALTER TABLE care_clients ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE care_locations ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE care_units ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
ALTER TABLE care_service_rates ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS care_clients_notion_uq ON care_clients(notion_page_id) WHERE notion_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS care_locations_notion_uq ON care_locations(notion_page_id) WHERE notion_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS care_units_notion_uq ON care_units(notion_page_id) WHERE notion_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS care_rates_notion_uq ON care_service_rates(notion_page_id) WHERE notion_page_id IS NOT NULL;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_page_id TEXT;
DROP INDEX IF EXISTS care_jobs_notion_uq;
CREATE UNIQUE INDEX IF NOT EXISTS care_jobs_notion_day_uq ON care_work_jobs(notion_page_id,work_date) WHERE notion_page_id IS NOT NULL;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_source_edited_at TIMESTAMPTZ;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_snapshot JSONB;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_state_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_mirrored_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_mirror_error TEXT NOT NULL DEFAULT '';
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS notion_next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS arrival BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS guest_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pre_inspection_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pre_inspection BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pre_inspection_started_at TIMESTAMPTZ;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pre_inspection_completed_at TIMESTAMPTZ;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pre_inspection_pay_cents INTEGER CHECK(pre_inspection_pay_cents BETWEEN 0 AND 10000000);
ALTER TABLE care_work_events ADD COLUMN IF NOT EXISTS notion_log_id TEXT;
ALTER TABLE care_work_events ADD COLUMN IF NOT EXISTS notion_log_error TEXT NOT NULL DEFAULT '';
ALTER TABLE care_work_events ADD COLUMN IF NOT EXISTS notion_log_next_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TABLE IF NOT EXISTS care_notion_sync (
 work_date DATE PRIMARY KEY,last_success_at TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 source_count INTEGER NOT NULL DEFAULT 0,imported_count INTEGER NOT NULL DEFAULT 0,
 errors JSONB NOT NULL DEFAULT '[]'::jsonb,error_message TEXT NOT NULL DEFAULT ''
);
INSERT INTO schema_migrations(migration_name) VALUES('017_notion_assignments') ON CONFLICT(migration_name) DO NOTHING;
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS pay_split_mode TEXT NOT NULL DEFAULT 'equal' CHECK(pay_split_mode IN ('equal','full_each'));

COMMIT;
