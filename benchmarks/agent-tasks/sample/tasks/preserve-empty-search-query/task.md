# Preserve an explicitly cleared search query

Update the search-state helper so clearing the field to an empty string stays
cleared. Preserve the previous-query fallback only when no query was supplied.
