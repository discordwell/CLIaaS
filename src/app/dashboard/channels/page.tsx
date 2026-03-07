import Link from 'next/link';

export const dynamic = 'force-dynamic';

// ---- Channel type definitions with mock data ----

interface ChannelStats {
  id: string;
  name: string;
  icon: string; // first letter
  status: 'connected' | 'disconnected' | 'error';
  volumeLast24h: number[];   // 24 hourly buckets
  slaCompliance: number;     // 0-100
  activeConversations: number;
  link?: string;
}

function getChannelData(): ChannelStats[] {
  return [
    {
      id: 'email',
      name: 'Email',
      icon: 'E',
      status: 'connected',
      volumeLast24h: [12, 8, 4, 2, 1, 1, 3, 15, 28, 34, 31, 26, 22, 29, 33, 27, 19, 14, 11, 8, 6, 5, 9, 14],
      slaCompliance: 94,
      activeConversations: 47,
    },
    {
      id: 'chat',
      name: 'Chat',
      icon: 'C',
      status: 'connected',
      volumeLast24h: [3, 1, 0, 0, 0, 0, 1, 8, 19, 24, 22, 18, 15, 21, 25, 20, 12, 9, 7, 4, 2, 1, 3, 6],
      slaCompliance: 98,
      activeConversations: 12,
    },
    {
      id: 'sms',
      name: 'SMS',
      icon: 'S',
      status: 'connected',
      volumeLast24h: [2, 1, 0, 0, 0, 0, 1, 4, 7, 9, 8, 6, 5, 8, 10, 7, 4, 3, 2, 1, 1, 0, 1, 3],
      slaCompliance: 91,
      activeConversations: 5,
    },
    {
      id: 'voice',
      name: 'Phone / Voice',
      icon: 'V',
      status: 'connected',
      volumeLast24h: [1, 0, 0, 0, 0, 0, 0, 3, 8, 14, 12, 9, 7, 11, 15, 10, 6, 4, 3, 1, 1, 0, 0, 2],
      slaCompliance: 87,
      activeConversations: 3,
      link: '/dashboard/channels/voice',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      icon: 'W',
      status: 'connected',
      volumeLast24h: [5, 3, 1, 1, 0, 0, 2, 7, 14, 18, 16, 12, 10, 15, 19, 14, 8, 6, 5, 3, 2, 1, 3, 7],
      slaCompliance: 96,
      activeConversations: 9,
    },
    {
      id: 'facebook',
      name: 'Facebook',
      icon: 'F',
      status: 'connected',
      volumeLast24h: [4, 2, 1, 0, 0, 0, 1, 5, 11, 14, 13, 10, 8, 12, 16, 11, 7, 5, 4, 2, 1, 1, 2, 5],
      slaCompliance: 93,
      activeConversations: 8,
    },
    {
      id: 'instagram',
      name: 'Instagram',
      icon: 'I',
      status: 'connected',
      volumeLast24h: [2, 1, 0, 0, 0, 0, 0, 3, 6, 9, 8, 5, 4, 7, 10, 6, 3, 2, 2, 1, 0, 0, 1, 3],
      slaCompliance: 95,
      activeConversations: 4,
    },
    {
      id: 'twitter',
      name: 'Twitter / X',
      icon: 'X',
      status: 'connected',
      volumeLast24h: [1, 1, 0, 0, 0, 0, 0, 2, 5, 7, 6, 4, 3, 5, 8, 5, 3, 2, 1, 1, 0, 0, 1, 2],
      slaCompliance: 89,
      activeConversations: 3,
    },
    {
      id: 'slack',
      name: 'Slack',
      icon: 'S',
      status: 'connected',
      volumeLast24h: [0, 0, 0, 0, 0, 0, 0, 2, 6, 10, 9, 7, 5, 8, 11, 8, 4, 3, 2, 1, 0, 0, 0, 1],
      slaCompliance: 97,
      activeConversations: 6,
    },
    {
      id: 'teams',
      name: 'Teams',
      icon: 'T',
      status: 'disconnected',
      volumeLast24h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      slaCompliance: 0,
      activeConversations: 0,
    },
    {
      id: 'telegram',
      name: 'Telegram',
      icon: 'G',
      status: 'error',
      volumeLast24h: [1, 0, 0, 0, 0, 0, 0, 1, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      slaCompliance: 72,
      activeConversations: 0,
    },
  ];
}

// ---- Helpers ----

function statusBadgeClass(status: ChannelStats['status']): string {
  switch (status) {
    case 'connected':
      return 'bg-emerald-400 text-black';
    case 'error':
      return 'bg-red-500 text-white';
    case 'disconnected':
      return 'bg-amber-400 text-black';
  }
}

function statusLabel(status: ChannelStats['status']): string {
  switch (status) {
    case 'connected':
      return 'CONNECTED';
    case 'error':
      return 'ERROR';
    case 'disconnected':
      return 'DISCONNECTED';
  }
}

// ---- Sparkline component (CSS bar chart) ----

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-px h-8 w-full">
      {data.map((v, i) => {
        const pct = (v / max) * 100;
        return (
          <div
            key={i}
            className="flex-1 bg-foreground/20 min-w-[2px]"
            style={{ height: `${Math.max(pct, 2)}%` }}
            title={`${v} conversations`}
          />
        );
      })}
    </div>
  );
}

// ---- Summary calculations ----

function computeSummary(channels: ChannelStats[]) {
  const totalVolumeToday = channels.reduce(
    (sum, ch) => sum + ch.volumeLast24h.reduce((a, b) => a + b, 0),
    0,
  );

  const activeChannels = channels.filter((ch) => ch.status === 'connected');
  const activeCount = activeChannels.length;

  // Average response time (mock): 4m 12s
  const avgResponseTime = '4m 12s';

  // Overall SLA compliance: weighted average by volume
  let weightedSla = 0;
  let totalWeight = 0;
  for (const ch of channels) {
    const vol = ch.volumeLast24h.reduce((a, b) => a + b, 0);
    if (vol > 0) {
      weightedSla += ch.slaCompliance * vol;
      totalWeight += vol;
    }
  }
  const overallSla = totalWeight > 0 ? Math.round(weightedSla / totalWeight) : 0;

  const totalActive = channels.reduce((sum, ch) => sum + ch.activeConversations, 0);

  return { totalVolumeToday, activeCount, avgResponseTime, overallSla, totalActive };
}

// ---- Page component ----

export default function ChannelsPage() {
  const channels = getChannelData();
  const summary = computeSummary(channels);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              Omnichannel
            </p>
            <h1 className="mt-4 text-4xl font-bold">Channels</h1>
          </div>
          <div className="border-2 border-line bg-panel px-6 py-3 text-center">
            <p className="font-mono text-3xl font-bold">{summary.activeCount}</p>
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Active Channels
            </p>
          </div>
        </div>
      </header>

      {/* Channel cards grid */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((ch) => {
          const totalVolume = ch.volumeLast24h.reduce((a, b) => a + b, 0);

          const cardContent = (
            <>
              {/* Top row: icon + name + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border-2 border-line bg-panel font-mono text-lg font-bold">
                    {ch.icon}
                  </div>
                  <span className="font-mono text-sm font-bold">{ch.name}</span>
                </div>
                <span
                  className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase border-2 border-line ${statusBadgeClass(ch.status)}`}
                >
                  {statusLabel(ch.status)}
                </span>
              </div>

              {/* Sparkline */}
              <div>
                <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                  Volume (24h)
                </p>
                <Sparkline data={ch.volumeLast24h} />
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between border-t-2 border-line pt-3">
                <div className="text-center">
                  <p className="font-mono text-lg font-bold">{totalVolume}</p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Total
                  </p>
                </div>
                <div className="text-center">
                  <p className={`font-mono text-lg font-bold ${
                    ch.slaCompliance >= 90
                      ? 'text-emerald-600'
                      : ch.slaCompliance >= 80
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }`}>
                    {ch.slaCompliance}%
                  </p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    SLA
                  </p>
                </div>
                <div className="text-center">
                  <p className="font-mono text-lg font-bold">{ch.activeConversations}</p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Active
                  </p>
                </div>
              </div>
            </>
          );

          if (ch.link) {
            return (
              <Link
                key={ch.id}
                href={ch.link}
                className="border-2 border-line bg-panel p-5 flex flex-col gap-4 transition-colors hover:bg-accent-soft cursor-pointer"
              >
                {cardContent}
              </Link>
            );
          }

          return (
            <div
              key={ch.id}
              className="border-2 border-line bg-panel p-5 flex flex-col gap-4"
            >
              {cardContent}
            </div>
          );
        })}
      </section>

      {/* Summary row */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{summary.totalVolumeToday}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Total Volume Today
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{summary.avgResponseTime}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Avg Response Time
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className={`font-mono text-3xl font-bold ${
            summary.overallSla >= 90
              ? 'text-emerald-600'
              : summary.overallSla >= 80
                ? 'text-amber-600'
                : 'text-red-600'
          }`}>
            {summary.overallSla}%
          </p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Overall SLA
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{summary.totalActive}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Active Conversations
          </p>
        </div>
      </section>
    </main>
  );
}
