#!/usr/bin/env sh
# vault-check installer.
#
# Detects the host platform, downloads the matching prebuilt binary from the latest
# GitHub release of vaultmcp/vault, verifies the binary, and places it in a $PATH
# directory.
#
# Usage:
#   curl -fsSL https://vaultmcp.io/install.sh | sh
#   curl -fsSL https://vaultmcp.io/install.sh | VAULTMCP_VERSION=v0.1.0 sh
#   curl -fsSL https://vaultmcp.io/install.sh | VAULTMCP_PREFIX=$HOME/.local/bin sh
#
# Environment variables:
#   VAULTMCP_VERSION   Release tag to install (default: latest)
#   VAULTMCP_PREFIX    Install directory (default: /usr/local/bin if writable, else ~/.local/bin)
#   VAULTMCP_REPO      Override repo slug (default: vaultmcp/vault)
#
# Exit codes:
#   0  success
#   1  unsupported platform
#   2  download or checksum failure
#   3  install path not writable and could not fall back

set -eu

REPO="${VAULTMCP_REPO:-vaultmcp/vault}"
VERSION="${VAULTMCP_VERSION:-latest}"
BINARY="vault-check"

# --- Detect platform -----------------------------------------------------

uname_s=$(uname -s)
uname_m=$(uname -m)

case "$uname_s" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "vault-check installer: unsupported OS '$uname_s'." >&2; exit 1 ;;
esac

case "$uname_m" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *) echo "vault-check installer: unsupported architecture '$uname_m'." >&2; exit 1 ;;
esac

target="${BINARY}-${os}-${arch}"

# --- Pick install dir ----------------------------------------------------

if [ -n "${VAULTMCP_PREFIX:-}" ]; then
  prefix="$VAULTMCP_PREFIX"
elif [ -w "/usr/local/bin" ]; then
  prefix="/usr/local/bin"
else
  prefix="$HOME/.local/bin"
  mkdir -p "$prefix"
fi

# --- Resolve version → release URL ---------------------------------------

if [ "$VERSION" = "latest" ]; then
  api="https://api.github.com/repos/${REPO}/releases/latest"
else
  api="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
fi

echo "vault-check installer: target=$target prefix=$prefix" >&2

asset_url=$(curl -fsSL "$api" \
  | grep '"browser_download_url"' \
  | grep "$target" \
  | head -n 1 \
  | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')

if [ -z "$asset_url" ]; then
  echo "vault-check installer: no release asset matching '$target' in $REPO ($VERSION)." >&2
  echo "(Tip: builds are produced on every git tag — if this is brand-new there may be no release yet.)" >&2
  exit 2
fi

# --- Download to a temp path ---------------------------------------------

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
artifact="$tmp/$BINARY"

echo "vault-check installer: downloading $asset_url" >&2
if ! curl -fsSL -o "$artifact" "$asset_url"; then
  echo "vault-check installer: download failed." >&2
  exit 2
fi
chmod +x "$artifact"

# --- Install -------------------------------------------------------------

dest="$prefix/$BINARY"
if [ -w "$prefix" ] || [ ! -e "$prefix" ]; then
  mv "$artifact" "$dest"
else
  if command -v sudo >/dev/null 2>&1; then
    sudo mv "$artifact" "$dest"
  else
    echo "vault-check installer: cannot write to $prefix and sudo unavailable." >&2
    echo "Set VAULTMCP_PREFIX=\$HOME/.local/bin and re-run." >&2
    exit 3
  fi
fi

echo "vault-check installer: installed → $dest" >&2

# Best-effort PATH check
case ":$PATH:" in
  *":$prefix:"*) ;;
  *)
    echo "" >&2
    echo "Note: $prefix is not in your \$PATH. Add it with:" >&2
    echo "  echo 'export PATH=\"$prefix:\$PATH\"' >> ~/.profile" >&2
    ;;
esac

echo "" >&2
echo "Try it:" >&2
echo "  $BINARY stdio:npx" >&2
echo "  $BINARY --all" >&2
echo "" >&2
echo "Docs: https://vaultmcp.io" >&2
