# Clear a rejected in-flight request

Update the in-flight request cache so a rejected load is removed and a later
attempt can retry. Preserve sharing while a request is still pending.
