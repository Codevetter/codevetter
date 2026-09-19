#!/bin/bash
# Headless installation from the same signed and notarized payload as the app.
set -euo pipefail

fail() { printf 'CodeVetter: %s\n' "$*" >&2; exit 1; }

prefix="${CODEVETTER_PREFIX:-$HOME/.local}"
version="${CODEVETTER_VERSION:-latest}"
[[ "$(uname -s)" = Darwin && "$(uname -m)" = arm64 ]] || fail 'Apple-silicon macOS is required.'
major="$(sw_vers -productVersion)"
[[ "${major%%.*}" -ge 14 ]] || fail 'macOS 14 or later is required.'
[[ "$prefix" = /* && "$prefix" != / ]] || fail 'CODEVETTER_PREFIX must be an absolute directory.'
if [[ "$version" != latest ]]; then
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'CODEVETTER_VERSION must be a stable version such as 1.14.1.'
fi

store="$prefix/share/codevetter"
mkdir -p "$store" "$prefix/bin"
for command in codevetter codevetter-mcp; do
  link="$prefix/bin/$command"
  if [[ -e "$link" || -L "$link" ]]; then
    [[ -L "$link" ]] || fail "Existing command is not installer-owned: $link"
    target="$(readlink "$link")"
    relative="${target#"$store/"}"
    installed_version="${relative%%/*}"
    [[ "$installed_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
      || fail "Existing symlink is not installer-owned: $link"
    [[ "$target" = "$store/$installed_version/$command" \
      || "$target" = "$store/$installed_version/CodeVetter.app/Contents/MacOS/$command" ]] \
      || fail "Existing symlink is not installer-owned: $link"
  fi
done

stage="$(mktemp -d "$store/.download.XXXXXX")"
# Failed downloads remain available for inspection; no broad cleanup is performed.
trap 'printf "Installation staging directory: %s\n" "$stage" >&2' EXIT
api='https://api.github.com/repos/Codevetter/codevetter/releases'
if [[ "$version" = latest ]]; then endpoint="$api/latest"; else endpoint="$api/tags/v$version"; fi
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  -H 'Accept: application/vnd.github+json' "$endpoint" -o "$stage/release.json"
tag="$(plutil -extract tag_name raw -o - "$stage/release.json")"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Release did not contain a stable version.'
version="${tag#v}"
destination="$store/$version"
[[ ! -e "$destination" ]] || fail "Version already exists at $destination; existing installation was preserved."
[[ "$(plutil -extract draft raw -o - "$stage/release.json")" = false ]] || fail 'Draft release rejected.'
[[ "$(plutil -extract prerelease raw -o - "$stage/release.json")" = false ]] || fail 'Prerelease rejected.'
asset="CodeVetter-$version-arm64.zip"
index=0
digest=''
while name="$(plutil -extract "assets.$index.name" raw -o - "$stage/release.json" 2>/dev/null)"; do
  if [[ "$name" = "$asset" ]]; then
    digest="$(plutil -extract "assets.$index.digest" raw -o - "$stage/release.json")"
    break
  fi
  index=$((index + 1))
done
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Release archive lacks a SHA-256 digest.'
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/Codevetter/codevetter/releases/download/$tag/$asset" -o "$stage/$asset"
actual="$(shasum -a 256 "$stage/$asset")"
[[ "${actual%% *}" = "${digest#sha256:}" ]] || fail 'Release checksum mismatch.'
ditto -x -k "$stage/$asset" "$stage/payload"
app="$stage/payload/CodeVetter.app"
codesign --verify --deep --strict \
  -R '=anchor apple generic and identifier "com.codevetter.desktop" and certificate leaf[subject.OU] = "8F7LXHTJZR"' "$app"
spctl --assess --type execute "$app"
[[ "$("$app/Contents/MacOS/codevetter" --version)" = "codevetter $version" ]] \
  || fail 'CLI version differs from the release tag.'
[[ -x "$app/Contents/MacOS/codevetter-mcp" ]] || fail 'MCP companion is missing.'

mkdir "$destination"
mv "$app" "$destination/CodeVetter.app"
for command in codevetter codevetter-mcp; do
  link="$prefix/bin/$command"
  # macOS current_exe preserves a symlink path. Execute the real bundle path
  # so runtime resources and sibling MCP paths remain discoverable.
  printf '#!/bin/bash\nexec %q "$@"\n' \
    "$destination/CodeVetter.app/Contents/MacOS/$command" > "$destination/$command"
  chmod 755 "$destination/$command"
  # Only links validated above may be replaced. Older version payloads stay intact.
  ln -s "$destination/$command" "$stage/$command"
  mv -f "$stage/$command" "$link"
done
printf 'Installed CodeVetter %s.\nCommands: %s/bin/codevetter and codevetter-mcp\n' "$version" "$prefix"
printf 'Add %s/bin to PATH if needed. No shell files or desktop applications were changed.\n' "$prefix"
