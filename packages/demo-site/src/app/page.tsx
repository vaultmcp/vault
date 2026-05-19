import { Hero } from '@/components/Hero';
import { ScanDemo } from '@/components/ScanDemo';
import { ThreatFeed } from '@/components/ThreatFeed';
import { Leaderboard } from '@/components/Leaderboard';
import { Install } from '@/components/Install';

export default function Page() {
  // In production this would point at the deployed collector. For local dev it points at
  // the proxy /api/feed which forwards to the configured collector URL.
  const collectorUrl = process.env.NEXT_PUBLIC_COLLECTOR_URL ?? '/api';
  return (
    <main>
      <Hero />
      <ScanDemo />
      <ThreatFeed collectorUrl={collectorUrl} />
      <Leaderboard />
      <Install />
    </main>
  );
}
