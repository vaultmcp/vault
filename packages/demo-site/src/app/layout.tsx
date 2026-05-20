import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://vaultmcp.io'),
  title: 'Vault — MCP prompt-injection proxy',
  description:
    '99.5% TPR · 0.0% FPR. Drop-in proxy that catches prompt injections in MCP tool responses before your agent sees them. Regex + embeddings + LLM judge + Base/EAS attestations.',
  openGraph: {
    title: 'Vault — MCP prompt-injection proxy',
    description: '99.5% TPR · 0.0% FPR · Drop-in prompt-injection proxy for MCP.',
    url: 'https://vaultmcp.io',
    siteName: 'Vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vault — MCP prompt-injection proxy',
    description: '99.5% TPR · 0.0% FPR on 185 published attacks. One command to deploy.',
    site: '@vaultmcpbase',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${mono.variable}`}>
      <body className="min-h-screen bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
