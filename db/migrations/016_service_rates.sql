BEGIN;
SELECT pg_advisory_xact_lock(160016);
CREATE TABLE IF NOT EXISTS care_service_rates (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES care_locations(id), unit_id UUID REFERENCES care_units(id),
 service_type TEXT NOT NULL CHECK(service_type IN ('regular','deep','touch_up')),
 sale_cents INTEGER NOT NULL CHECK(sale_cents BETWEEN 0 AND 100000000),
 cleaner_pay_cents INTEGER NOT NULL CHECK(cleaner_pay_cents BETWEEN 0 AND 10000000), inspector_pay_cents INTEGER NOT NULL CHECK(inspector_pay_cents BETWEEN 0 AND 10000000),
 effective_from DATE NOT NULL,effective_to DATE,CHECK(effective_to IS NULL OR effective_to>=effective_from),
 active BOOLEAN NOT NULL DEFAULT TRUE, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE care_service_rates ADD COLUMN IF NOT EXISTS room_type TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS care_rates_scope_idx ON care_service_rates(location_id,unit_id,service_type,effective_from);
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS sale_cents INTEGER CHECK(sale_cents BETWEEN 0 AND 100000000);
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS applied_rate_id UUID REFERENCES care_service_rates(id);
ALTER TABLE care_work_jobs ADD COLUMN IF NOT EXISTS rate_snapshot JSONB;
INSERT INTO schema_migrations(migration_name) VALUES('016_service_rates') ON CONFLICT(migration_name) DO NOTHING;
COMMIT;
