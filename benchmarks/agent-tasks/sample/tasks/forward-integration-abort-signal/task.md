# Forward cancellation to an integration client

Update the issue-fetching wrapper so the caller's abort signal reaches the
underlying integration request. Preserve the issue path and returned response.
