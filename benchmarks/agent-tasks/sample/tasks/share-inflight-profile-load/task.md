# Share concurrent in-flight profile loads

Update the profile loader so concurrent requests for the same profile share one
in-flight operation. Once that operation settles, a later request must start a
fresh load. Preserve returned profile values.
