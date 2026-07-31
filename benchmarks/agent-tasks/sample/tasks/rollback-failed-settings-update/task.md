# Roll back a failed settings update

Update the settings transaction so a failed commit triggers rollback and the
original failure still rejects. Preserve the successful path without rollback.
