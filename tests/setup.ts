import 'dotenv/config'

// The two hard rules live in Postgres, so the tests talk to a real Postgres.
// TEST_DATABASE_URL points at a throwaway database that is rebuilt per run.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://berth:berth@localhost:55432/berth_test'
