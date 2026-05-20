import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://vaultmcp.io'),
  title: 'Vault — MCP runtime security',
  description: 'The security layer for the agent web. MCP is wide open. We close it.',
  openGraph: {
    title: 'Vault — MCP runtime security',
    description: 'Drop-in proxy that scans every MCP tool response for prompt injection.',
    url: 'https://vaultmcp.io',
    siteName: 'Vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vault — MCP runtime security',
    description: 'MCP is wide open. We close it.',
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
