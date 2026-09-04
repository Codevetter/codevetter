//! Local-calendar → UTC window boundaries for SQL timestamp comparisons.

use chrono::{Local, NaiveDate, TimeZone, Utc};

/// Midnight at the start of `date` in the user's local timezone, expressed as
/// a UTC `YYYY-MM-DDTHH:MM:SS` string.
///
/// Session timestamps are stored as UTC RFC3339 (`…T12:34:56.789Z`), so window
/// cutoffs must be UTC instants to compare correctly. Formatting a *local*
/// date with a literal `Z` suffix — the pattern this replaces — shifted every
/// window by the UTC offset (5.5h early in IST). Second-precision output still
/// compares lexically against the stored millisecond timestamps.
pub fn local_day_start_utc(date: NaiveDate) -> String {
    Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .earliest()
        .map(|dt| {
            dt.with_timezone(&Utc)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        })
        // Unreachable in practice (midnight never lands in a DST gap for
        // supported zones) — fall back to the naive boundary.
        .unwrap_or_else(|| format!("{}T00:00:00", date.format("%Y-%m-%d")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_is_a_utc_instant_offset_from_local_midnight() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 29).unwrap();
        let boundary = local_day_start_utc(date);
        // The boundary parses back to exactly local midnight of that date.
        let parsed = chrono::NaiveDateTime::parse_from_str(&boundary, "%Y-%m-%dT%H:%M:%S")
            .expect("boundary parses");
        let local = Utc.from_utc_datetime(&parsed).with_timezone(&Local);
        assert_eq!(local.date_naive(), date);
        assert_eq!(local.time(), chrono::NaiveTime::MIN);
    }
}
