# Ignore a stale search response

Update search result handling so an older request cannot overwrite the active
request's results. Preserve current-response updates and the active query.
