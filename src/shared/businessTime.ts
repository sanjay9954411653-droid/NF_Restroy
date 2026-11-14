/**
 * "Today" for the restaurant — not for the database server.
 *
 * Postgres CURRENT_DATE follows the DB server's clock (UTC on Railway), so for
 * an Indian restaurant "today" would flip at 5:30 AM instead of midnight:
 * late-night orders landed on yesterday's report and token numbers reset at
 * 5:30 AM. Timestamps in this app are stored as UTC (TIMESTAMP without zone),
 * so we convert them to the business timezone before comparing dates.
 *
 * Set BUSINESS_TIMEZONE in Railway (IANA name) to change it; default Asia/Kolkata.
 */
const RAW = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
// Only plain IANA names — this is interpolated into SQL, so never trust anything else.
export const BUSINESS_TZ = /^[A-Za-z0-9_+\-/]+$/.test(RAW) ? RAW : 'Asia/Kolkata';

/** SQL: the business-local calendar date of a stored UTC timestamp column. */
// orders / payments timestamps are TIMESTAMPTZ (a real instant), so convert straight to the
// business timezone. The ::timestamptz cast is a no-op for them and also keeps any older plain
// TIMESTAMP column (stored as UTC) working. (The earlier "AT TIME ZONE 'UTC'" first step shifted
// TIMESTAMPTZ values 5h30m early: payments made before ~11 AM IST showed under yesterday.)
export const localDay = (col: string): string =>
  `((${col})::timestamptz AT TIME ZONE '${BUSINESS_TZ}')::date`;

/** SQL: today's date in the business timezone. */
export const todayLocal = `(NOW() AT TIME ZONE '${BUSINESS_TZ}')::date`;

/** SQL condition: the column falls on today (business timezone). */
export const isToday = (col: string): string => `${localDay(col)} = ${todayLocal}`;
