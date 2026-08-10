# CodeVetter 1BRC artifact record

## Origin

This artifact adapts the task contract from Gunnar Morling's
[One Billion Row Challenge](https://github.com/gunnarmorling/1brc), accessed on
2026-08-10. The upstream repository is Apache-2.0 licensed.

`official-stations.csv` is derived from the 413 `WeatherStation` declarations
in upstream `CreateMeasurements.java`. That source attributes the original city
temperature data to Wikipedia. The Node.js and Go aggregation implementations
are original CodeVetter code; no challenge solution was copied.

## Preserved contract

- rows use `station;temperature\n` with UTF-8 station names;
- temperatures have exactly one fractional digit;
- aggregation calculates minimum, mean, and maximum per station;
- output is sorted and formatted as `{station=min/mean/max}`; and
- mean rounding follows the challenge's round-toward-positive behavior.

## Deliberate differences

- The fixture uses the official 413 station names and means but a deterministic
  pseudo-random Gaussian generator. The authoritative Java generator uses
  `ThreadLocalRandom`, so the files are distribution-compatible, not identical.
- This is a Node.js/Go laboratory, not an eligible Java submission to the
  challenge's closed 2024 leaderboard.
- Results are measured on the recorded local machine and cannot be compared
  directly with leaderboard or third-party hardware.
- The committed result is 100 million rows. Any one-billion timing is an
  unverified linear projection until the complete file is run.

## Evidence policy

Every campaign lane consumes the same SHA-256-identified fixture and must match
the fixture's expected output digest. The campaign records all five samples,
discards the fastest and slowest, and reports the mean of the remaining three.
Temporary input is removed after the campaign by default.
