# Homebrew formula for vault-check — on-chain MCP reputation lookup.
#
# Once published to a tap (vaultmcp/homebrew-tap):
#   brew tap vaultmcp/tap
#   brew install vault-check
#
# After acceptance into homebrew-core (post-launch):
#   brew install vault-check
#
# Versions, URLs, and SHA-256 sums are injected by the release workflow on tag push.
# See .github/workflows/release.yml for how the formula gets rewritten.

class VaultCheck < Formula
  desc "Look up an MCP server's on-chain Vault reputation score"
  homepage "https://vaultmcp.io"
  version "VERSION_PLACEHOLDER"

  on_macos do
    on_arm do
      url "https://github.com/vaultmcp/vault/releases/download/VERSION_PLACEHOLDER/vault-check-darwin-arm64"
      sha256 "SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/vaultmcp/vault/releases/download/VERSION_PLACEHOLDER/vault-check-darwin-x64"
      sha256 "SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/vaultmcp/vault/releases/download/VERSION_PLACEHOLDER/vault-check-linux-arm64"
      sha256 "SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/vaultmcp/vault/releases/download/VERSION_PLACEHOLDER/vault-check-linux-x64"
      sha256 "SHA256_LINUX_X64"
    end
  end

  def install
    bin.install Dir["*"].first => "vault-check"
  end

  test do
    assert_match "score", shell_output("#{bin}/vault-check stdio:npx 2>&1", 0)
  end
end
