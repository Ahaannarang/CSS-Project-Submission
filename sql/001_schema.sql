-- Berth — dock scheduling schema
-- The two hard rules (no double-booking, vessels must fit) are enforced HERE,
-- in the database, not in application code. See README "Key decisions".

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- enums
DO $$ BEGIN CREATE TYPE reservation_kind   AS ENUM ('vessel','event');                       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reservation_status AS ENUM ('active','cancelled','flagged');         EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reservation_source AS ENUM ('manual','legacy_import');               EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE issue_kind AS ENUM (
  'overlap',            -- two active reservations fight for one berth
  'misfit',             -- vessel longer than the berth it was put in
  'parse_error',        -- source row could not be read at all
  'unknown_berth',      -- berth label in the sheet has no known length
  'unknown_vessel',     -- vessel name not found in the reference tabs
  'vessel_conflict',    -- same vessel in two berths on the same day
  'annotation'          -- an operational note sharing a cell with bookings
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- settings
-- A3: the fit margin is configurable per facility.
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value numeric NOT NULL
);
INSERT INTO settings (key, value) VALUES ('margin_ft', 0) ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- berths
CREATE TABLE IF NOT EXISTS berths (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  -- NULL = length unknown (some legacy sections list no length). Fit cannot be
  -- enforced for those, so assignments to them are reported in the audit.
  length_ft numeric CHECK (length_ft IS NULL OR length_ft > 0),
  notes     text,
  sort_order int NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- vessels
CREATE TABLE IF NOT EXISTS vessels (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  length_ft numeric CHECK (length_ft IS NULL OR length_ft > 0),
  type      text,
  -- every spelling seen in the legacy sheets that maps to this vessel
  aliases   text[] NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------- reservations
CREATE TABLE IF NOT EXISTS reservations (
  id         serial PRIMARY KEY,
  berth_id   int NOT NULL REFERENCES berths(id) ON DELETE RESTRICT,
  vessel_id  int REFERENCES vessels(id) ON DELETE RESTRICT,
  kind       reservation_kind   NOT NULL,
  title      text,
  during     daterange NOT NULL,          -- A2: half-open [start, end+1)
  status     reservation_status NOT NULL DEFAULT 'active',
  source     reservation_source NOT NULL DEFAULT 'manual',
  source_key text,                        -- dedupe key, makes import idempotent
  created_at timestamptz NOT NULL DEFAULT now(),

  -- A vessel booking needs a vessel; an event needs a title and no vessel.
  CONSTRAINT kind_shape CHECK (
    (kind = 'vessel' AND vessel_id IS NOT NULL) OR
    (kind = 'event'  AND vessel_id IS NULL AND title IS NOT NULL)
  ),
  -- Reject empty or backwards ranges outright (FR1: "end before start is rejected").
  CONSTRAINT during_not_empty CHECK (NOT isempty(during)),
  CONSTRAINT during_bounded   CHECK (lower(during) IS NOT NULL AND upper(during) IS NOT NULL)
);

-- THE core guarantee: no two ACTIVE reservations may overlap on one berth.
-- Enforced by the database, so the API and UI cannot be tricked into breaking it.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS no_double_booking;
ALTER TABLE reservations ADD  CONSTRAINT no_double_booking
  EXCLUDE USING gist (berth_id WITH =, during WITH &&)
  WHERE (status = 'active');

CREATE UNIQUE INDEX IF NOT EXISTS reservations_source_key_uq
  ON reservations (source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_vessel_idx ON reservations (vessel_id);
CREATE INDEX IF NOT EXISTS reservations_during_idx ON reservations USING gist (during);

-- ---------------------------------------------------------------- fit rule
-- The fit rule spans two tables, so a constraint can't express it; a trigger can.
CREATE OR REPLACE FUNCTION enforce_vessel_fits() RETURNS trigger AS $$
DECLARE
  v_len numeric;
  b_len numeric;
  v_name text;
  b_name text;
  margin numeric;
BEGIN
  IF NEW.status <> 'active' OR NEW.kind <> 'vessel' THEN
    RETURN NEW;                      -- flagged/cancelled history is loaded as-is (A8)
  END IF;

  SELECT length_ft, name INTO v_len, v_name FROM vessels WHERE id = NEW.vessel_id;
  SELECT length_ft, name INTO b_len, b_name FROM berths  WHERE id = NEW.berth_id;
  SELECT value          INTO margin        FROM settings WHERE key = 'margin_ft';

  -- Unknown lengths cannot be checked; those rows are surfaced in the audit instead.
  IF v_len IS NULL OR b_len IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_len + COALESCE(margin, 0) > b_len THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('%s is %s ft; %s is %s ft', v_name, v_len, b_name, b_len),
      DETAIL  = format('{"rule":"fit","vessel":%s,"vessel_ft":%s,"berth":%s,"berth_ft":%s,"margin_ft":%s}',
                       to_json(v_name), v_len, to_json(b_name), b_len, COALESCE(margin,0)),
      HINT    = 'vessel_does_not_fit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vessel_fits ON reservations;
CREATE TRIGGER vessel_fits
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_vessel_fits();

-- ---------------------------------------------------------------- import issues
CREATE TABLE IF NOT EXISTS import_issues (
  id             serial PRIMARY KEY,
  reservation_id int REFERENCES reservations(id) ON DELETE CASCADE,
  kind           issue_kind NOT NULL,
  year           int,
  berth_id       int REFERENCES berths(id) ON DELETE SET NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS import_issues_kind_idx ON import_issues (kind);
CREATE INDEX IF NOT EXISTS import_issues_year_idx ON import_issues (year);

-- Bookkeeping so the audit page can reconcile "rows read = clean + flagged + errors".
CREATE TABLE IF NOT EXISTS import_runs (
  id         serial PRIMARY KEY,
  source     text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  stats      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- A stable identity per issue, so re-running the import does not duplicate the
-- audit and does not lose the "resolved" ticks staff have already made (FR6).
ALTER TABLE import_issues ADD COLUMN IF NOT EXISTS issue_key text;
CREATE UNIQUE INDEX IF NOT EXISTS import_issues_key_uq ON import_issues (issue_key) WHERE issue_key IS NOT NULL;
