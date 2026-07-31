# Wait for a transaction commit

Update persistence so success is returned only after the transaction commits.
Preserve the write value, write-before-commit order, and success result.
