# Retain the latest autocomplete result

Update autocomplete state so a slower older request cannot overwrite the
newest result. Preserve each caller's returned response and current-state
access.
