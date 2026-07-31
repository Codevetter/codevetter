# Sort suggestions without mutating caller state

Update the suggestion sorter so it does not mutate the array owned by browser
state. Preserve descending score order and the original suggestion objects.
