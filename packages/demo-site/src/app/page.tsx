import { Hero } from '@/components/Hero';
import { WhyVault } from '@/components/WhyVault';
import { WhatWePublish } from '@/components/WhatWePublish';
import { ScanDemo } from '@/components/ScanDemo';
import { ThreatFeed } from '@/components/ThreatFeed';
import { Install } from '@/components/Install';

export const revalidate = 60;

export default function Page() {
  // In production this would point at the deployed collector. For local dev it points at
  // the proxy /api/feed which forwards to the configured collector URL.
  const collectorUrl = process.env.NEXT_PUBLIC_COLLECTOR_URL ?? '/api';
  return (
    <main>
      <Hero />
      <WhyVault />
      <WhatWePublish />
      <ScanDemo />
      <ThreatFeed collectorUrl={collectorUrl} />
      <Install />
    </main>
  );
}
