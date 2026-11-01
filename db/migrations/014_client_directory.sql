BEGIN;
SELECT pg_advisory_xact_lock(140014);
CREATE TABLE IF NOT EXISTS care_clients (
 id UUID PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 billing_name TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '', billing_address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS care_clients_name_uq ON care_clients(lower(trim(name)));
CREATE TABLE IF NOT EXISTS care_locations (
 id UUID PRIMARY KEY, client_id UUID NOT NULL REFERENCES care_clients(id), name TEXT NOT NULL,
 address TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
 version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS care_locations_name_uq ON care_locations(client_id,lower(trim(name)));
CREATE TABLE IF NOT EXISTS care_units (
 id UUID PRIMARY KEY, location_id UUID REFERENCES care_locations(id), name TEXT NOT NULL,
 unit_key TEXT NOT NULL, room_type TEXT NOT NULL DEFAULT '', building TEXT NOT NULL DEFAULT '',
 bedrooms INTEGER CHECK(bedrooms BETWEEN 0 AND 100), bathrooms NUMERIC(5,1) CHECK(bathrooms BETWEEN 0 AND 100),
 notes TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
 legacy_key TEXT UNIQUE, review_required BOOLEAN NOT NULL DEFAULT FALSE,
 version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (location_id IS NOT NULL OR review_required)
);
CREATE UNIQUE INDEX IF NOT EXISTS care_units_location_key_uq ON care_units(location_id,unit_key);
CREATE TABLE IF NOT EXISTS care_directory_audit (
 id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id UUID NOT NULL,
 detail JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO care_clients(id,name,billing_name) VALUES ('00000000-0000-4000-8000-000000000001','Still Waters Resort','Still Waters Resort') ON CONFLICT(id) DO NOTHING;
INSERT INTO care_locations(id,client_id,name) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Still Waters Resort') ON CONFLICT(id) DO NOTHING;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS care_unit_id UUID REFERENCES care_units(id);
CREATE INDEX IF NOT EXISTS rooms_care_unit_idx ON rooms(care_unit_id,work_date);
-- All legacy room readers remain in their existing operational scope. New directory units
-- cannot enter daily operations until every downstream reader is location-aware.
INSERT INTO schema_migrations(migration_name) VALUES ('014_client_directory') ON CONFLICT(migration_name) DO NOTHING;
COMMIT;
