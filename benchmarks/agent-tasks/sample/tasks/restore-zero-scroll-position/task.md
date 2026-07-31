# Restore an explicit zero scroll position

Update the browser-state helper so a saved position at the top of the page
restores to zero. Preserve positive saved positions and fallback behavior when
no position was saved.
