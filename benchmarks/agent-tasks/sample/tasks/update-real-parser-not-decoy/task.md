# Preserve zero in the configuration parser

Update the configuration parser so the string "0" produces numeric zero
instead of the fallback. Preserve positive parsing and invalid-value fallback.
