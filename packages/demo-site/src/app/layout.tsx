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
    'Production prompt-injection firewall for MCP. 100% TPR on a public eval (95.5%+ CI lower bound). 0% FPR. Open methodology.',
  openGraph: {
    title: 'VaultMCP — Stop prompt injection in MCP',
    description: '100% detection rate on 80-attack public eval (95.5%+ at 95% confidence). 0.0% FPR on 100 benign documents. Drop-in MCP proxy.',
    url: 'https://vaultmcp.io',
    siteName: 'Vault',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VaultMCP — Stop prompt injection in MCP',
    description: '100% detection rate on 80-attack public eval (95.5%+ at 95% confidence). 0.0% FPR. One command to deploy.',
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
