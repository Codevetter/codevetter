# Normalize a query at one integration boundary

Ensure surrounding whitespace is removed before a query reaches the external
client. The normalization may live in either the caller or adapter boundary;
this is one observable outcome, not two separate fixes. Preserve the request
path, returned response, and already-normalized queries.
