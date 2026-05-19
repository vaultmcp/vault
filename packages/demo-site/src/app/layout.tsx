import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vault — MCP runtime security',
  description: 'The security layer for the agent web. MCP is wide open. We close it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-ink scan-line">{children}</body>
    </html>
  );
}
