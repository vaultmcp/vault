import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://vaultmcp.io'),
  title: 'Vault — MCP prompt-injection proxy',
  description:
    'Drop-in proxy that scans MCP tool responses for prompt-injection patterns. Layered detection, capability firewall, on-chain reputation. 45.2% TPR / 0.9% FPR measured on a public holdout (L3 disabled); see repo LIMITATIONS for what gets through.',
  openGraph: {
    title: 'Vault — MCP prompt-injection proxy',
    description:
      'Drop-in proxy that scans MCP tool responses for prompt-injection patterns. Layered detection, capability firewall, on-chain reputation.',
    url: 'https://vaultmcp.io',
    siteName: 'Vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vault — MCP prompt-injection proxy',
    description:
      'Layered prompt-injection detection for MCP tool responses. 45.2% TPR / 0.9% FPR on our public holdout with L3 disabled.',
    site: '@vaultmcpbase',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-ink scan-line">{children}</body>
    </html>
  );
}
