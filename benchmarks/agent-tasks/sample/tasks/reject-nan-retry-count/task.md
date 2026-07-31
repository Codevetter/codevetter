# Reject a non-finite retry count

Update retry-count validation so NaN is not accepted as a count. Preserve zero
and positive integer acceptance and non-number rejection.
