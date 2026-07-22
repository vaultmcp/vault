import { AnnounceBar } from '@/components/AnnounceBar';
import { CABar } from '@/components/CABar';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { WhyVault } from '@/components/WhyVault';
import { AgenticTrading } from '@/components/AgenticTrading';
import { RobinhoodBoard } from '@/components/RobinhoodBoard';
import { WhatWePublish } from '@/components/WhatWePublish';
import { ScanDemo } from '@/components/ScanDemo';
import { ThreatFeed } from '@/components/ThreatFeed';
import { Install } from '@/components/Install';

export const revalidate = 60;

export default function Page() {
  // Always same-origin. The Next.js /api/feed route is the canonical client-facing path —
  // it proxies to the collector server-side, dodging mixed-content + CORS. The previous
  // NEXT_PUBLIC_COLLECTOR_URL env var pointed the browser directly at the collector and
  // got blocked by both. See packages/demo-site/src/app/api/feed/route.ts.
  const collectorUrl = '/api';
  return (
    <>
      <CABar />
      <AnnounceBar />
      <Header />
      <main>
        <Hero />
        <WhyVault />
        <AgenticTrading />
        <RobinhoodBoard />
        <WhatWePublish />
        <ScanDemo />
        <ThreatFeed collectorUrl={collectorUrl} />
        <Install />
      </main>
    </>
  );
}
