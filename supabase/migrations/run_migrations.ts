import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const client = new Client({
  host: `db.${process.env.SUPABASE_PROJECT_REF}.supabase.co`,
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const migrations: { name: string; sql: string }[] = [
  {
    name: '001_captains',
    sql: `
      CREATE TABLE IF NOT EXISTS captains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        whatsapp_id TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        boat_name TEXT,
        license_number TEXT,
        onboarding_step TEXT NOT NULL DEFAULT 'start',
        is_active BOOLEAN NOT NULL DEFAULT false,
        stripe_account_id TEXT UNIQUE,
        stripe_onboarding_url TEXT,
        stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false,
        stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
        total_trips INT NOT NULL DEFAULT 0,
        total_revenue_aed NUMERIC(10, 2) NOT NULL DEFAULT 0
      );

      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS captains_updated_at ON captains;
      CREATE TRIGGER captains_updated_at
        BEFORE UPDATE ON captains
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      ALTER TABLE captains ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '002_whatsapp_groups',
    sql: `
      CREATE TABLE IF NOT EXISTS whatsapp_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        group_id TEXT UNIQUE NOT NULL,
        group_name TEXT,
        captain_id UUID NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '003_trips',
    sql: `
      DO $$ BEGIN
        CREATE TYPE trip_type AS ENUM ('fishing', 'diving', 'cruising', 'other');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE trip_status AS ENUM ('draft', 'open', 'confirmed', 'cancelled', 'completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS trips (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        captain_id UUID NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
        group_id UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
        trip_type trip_type NOT NULL DEFAULT 'fishing',
        title TEXT NOT NULL,
        description TEXT,
        departure_at TIMESTAMPTZ NOT NULL,
        duration_hours NUMERIC(4, 1),
        meeting_point TEXT,
        max_seats INT NOT NULL CHECK (max_seats >= 1),
        threshold INT NOT NULL CHECK (threshold >= 1),
        price_per_person_aed NUMERIC(10, 2) NOT NULL,
        current_bookings INT NOT NULL DEFAULT 0 CHECK (current_bookings >= 0),
        status trip_status NOT NULL DEFAULT 'open',
        announcement_message_id TEXT,
        threshold_check_sent_at TIMESTAMPTZ,
        confirmed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        cancellation_reason TEXT
      );

      DROP TRIGGER IF EXISTS trips_updated_at ON trips;
      CREATE TRIGGER trips_updated_at
        BEFORE UPDATE ON trips
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE INDEX IF NOT EXISTS idx_trips_departure_status ON trips(departure_at, status)
        WHERE status = 'open';

      ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '004_bookings',
    sql: `
      DO $$ BEGIN
        CREATE TYPE booking_status AS ENUM (
          'pending_payment', 'authorized', 'confirmed', 'cancelled', 'refunded'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        captain_id UUID NOT NULL REFERENCES captains(id),
        guest_whatsapp_id TEXT NOT NULL,
        guest_name TEXT,
        seat_number INT,
        num_seats INT NOT NULL DEFAULT 1 CHECK (num_seats >= 1),
        price_per_seat_aed NUMERIC(10, 2) NOT NULL,
        total_amount_aed NUMERIC(10, 2) NOT NULL,
        platform_fee_aed NUMERIC(10, 2),
        captain_payout_aed NUMERIC(10, 2),
        status booking_status NOT NULL DEFAULT 'pending_payment',
        payment_link TEXT,
        stripe_customer_id TEXT,
        stripe_payment_intent_id TEXT,
        payment_link_sent_at TIMESTAMPTZ,
        authorized_at TIMESTAMPTZ,
        confirmed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        cancellation_reason TEXT,
        UNIQUE(trip_id, guest_whatsapp_id)
      );

      DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
      CREATE TRIGGER bookings_updated_at
        BEFORE UPDATE ON bookings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE INDEX IF NOT EXISTS idx_bookings_trip_status ON bookings(trip_id, status);
      CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_whatsapp_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_authorized_at ON bookings(authorized_at)
        WHERE status = 'authorized';

      ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '005_stripe_intents',
    sql: `
      CREATE TABLE IF NOT EXISTS stripe_intents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        trip_id UUID NOT NULL REFERENCES trips(id),
        captain_id UUID NOT NULL REFERENCES captains(id),
        payment_intent_id TEXT NOT NULL UNIQUE,
        stripe_customer_id TEXT,
        amount_aed NUMERIC(10, 2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'aed',
        is_current BOOLEAN NOT NULL DEFAULT true,
        stripe_status TEXT NOT NULL,
        captured_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        reauth_count INT NOT NULL DEFAULT 0,
        application_fee_amount NUMERIC(10, 2),
        transfer_amount NUMERIC(10, 2)
      );

      CREATE INDEX IF NOT EXISTS idx_stripe_intents_booking ON stripe_intents(booking_id, is_current);

      ALTER TABLE stripe_intents ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '006_reauth_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS reauth_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        scheduled_for TIMESTAMPTZ NOT NULL,
        executed_at TIMESTAMPTZ,
        is_complete BOOLEAN NOT NULL DEFAULT false,
        attempt_count INT NOT NULL DEFAULT 0,
        qstash_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_reauth_jobs_scheduled ON reauth_jobs(scheduled_for, is_complete)
        WHERE is_complete = false;
    `,
  },
  {
    name: '007a_trips_add_location_url',
    sql: `
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS location_url TEXT;
    `,
  },
  {
    name: '007_notification_log',
    sql: `
      CREATE TABLE IF NOT EXISTS notification_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        recipient_wa_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        template_name TEXT,
        direction TEXT NOT NULL DEFAULT 'outbound',
        trip_id UUID REFERENCES trips(id),
        booking_id UUID REFERENCES bookings(id),
        captain_id UUID REFERENCES captains(id),
        meta_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notification_log_booking ON notification_log(booking_id);
      CREATE INDEX IF NOT EXISTS idx_notification_log_trip ON notification_log(trip_id);
    `,
  },
  {
    name: '008_payouts',
    sql: `
      CREATE TABLE IF NOT EXISTS payouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        trip_id UUID NOT NULL REFERENCES trips(id),
        captain_id UUID NOT NULL REFERENCES captains(id),
        gross_amount NUMERIC(10,2) NOT NULL,
        commission_amount NUMERIC(10,2) NOT NULL,
        payout_amount NUMERIC(10,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        bank_reference TEXT,
        processed_at TIMESTAMPTZ,
        whatsapp_notified BOOLEAN NOT NULL DEFAULT false
      );

      DROP TRIGGER IF EXISTS payouts_updated_at ON payouts;
      CREATE TRIGGER payouts_updated_at
        BEFORE UPDATE ON payouts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();

      CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
      CREATE INDEX IF NOT EXISTS idx_payouts_captain ON payouts(captain_id);

      ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: '009_captains_bank_details',
    sql: `
      ALTER TABLE captains ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE captains ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
    `,
  },
  {
    name: '010_admin_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      INSERT INTO admin_settings (key, value) VALUES
        ('commission_percentage', '10'),
        ('admin_whatsapp_number', ''),
        ('payout_reminder_hours', '48')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    name: '011_atomic_booking_functions',
    sql: `
      -- Atomically reserve a seat: locks the trip row, checks availability, inserts booking
      CREATE OR REPLACE FUNCTION reserve_seat(
        p_trip_id UUID,
        p_captain_id UUID,
        p_guest_whatsapp_id TEXT,
        p_guest_name TEXT,
        p_num_seats INT,
        p_price_per_seat NUMERIC,
        p_total_amount NUMERIC
      ) RETURNS UUID AS $$
      DECLARE
        v_trip RECORD;
        v_active_count INT;
        v_booking_id UUID;
      BEGIN
        SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;

        IF v_trip IS NULL OR v_trip.status NOT IN ('open', 'confirmed') THEN
          RAISE EXCEPTION 'TRIP_NOT_AVAILABLE';
        END IF;

        SELECT COALESCE(SUM(num_seats), 0) INTO v_active_count
        FROM bookings
        WHERE trip_id = p_trip_id AND status != 'cancelled';

        IF v_active_count + p_num_seats > v_trip.max_seats THEN
          RAISE EXCEPTION 'NO_SEATS_AVAILABLE';
        END IF;

        INSERT INTO bookings (trip_id, captain_id, guest_whatsapp_id, guest_name, num_seats, price_per_seat_aed, total_amount_aed, status)
        VALUES (p_trip_id, p_captain_id, p_guest_whatsapp_id, p_guest_name, p_num_seats, p_price_per_seat, p_total_amount, 'pending_payment')
        RETURNING id INTO v_booking_id;

        RETURN v_booking_id;
      END;
      $$ LANGUAGE plpgsql;

      -- Atomically increment/decrement trip booking count
      CREATE OR REPLACE FUNCTION atomic_increment_bookings(
        p_trip_id UUID,
        p_delta INT
      ) RETURNS INT AS $$
      DECLARE
        v_new_count INT;
      BEGIN
        UPDATE trips
        SET current_bookings = GREATEST(current_bookings + p_delta, 0)
        WHERE id = p_trip_id
        RETURNING current_bookings INTO v_new_count;

        RETURN v_new_count;
      END;
      $$ LANGUAGE plpgsql;
    `,
  },
];

async function run() {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL\n');

  for (const migration of migrations) {
    console.log(`Running ${migration.name}...`);
    try {
      await client.query(migration.sql);
      console.log(`  ${migration.name} ✓`);
    } catch (err: any) {
      console.error(`  ${migration.name} FAILED:`, err.message);
    }
  }

  // Verify tables exist
  const result = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log('\nTables in database:');
  for (const row of result.rows) {
    console.log(`  - ${row.table_name}`);
  }

  await client.end();
  console.log('\nDone!');
}

run().catch(console.error);
