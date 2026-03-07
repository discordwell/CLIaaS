import Link from 'next/link';
import {
  getAgents,
  getAllCalls,
  getActiveCalls,
  getQueueMetrics,
  type VoiceCall,
  type VoiceAgent,
  type VoiceQueueMetrics,
  seedDemoData,
} from '@/lib/channels/voice-store';
import { getIVRConfig, type IVRMenu, type IVRMenuItem } from '@/lib/channels/voice-ivr';

export const dynamic = 'force-dynamic';

// ---- Helpers ----

function formatDuration(seconds?: number): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function agentStatusBadge(status: VoiceAgent['status']): { class: string; label: string } {
  switch (status) {
    case 'available':
      return { class: 'bg-emerald-400 text-black', label: 'AVAILABLE' };
    case 'busy':
      return { class: 'bg-red-500 text-white', label: 'BUSY' };
    case 'offline':
      return { class: 'bg-zinc-400 text-black', label: 'OFFLINE' };
    case 'wrap-up':
      return { class: 'bg-amber-400 text-black', label: 'WRAP-UP' };
  }
}

function callStatusBadge(status: VoiceCall['status']): { class: string; label: string } {
  switch (status) {
    case 'ringing':
      return { class: 'bg-amber-400 text-black', label: 'RINGING' };
    case 'in-progress':
      return { class: 'bg-emerald-400 text-black', label: 'IN PROGRESS' };
    case 'completed':
      return { class: 'bg-zinc-300 text-black', label: 'COMPLETED' };
    case 'busy':
      return { class: 'bg-red-500 text-white', label: 'BUSY' };
    case 'no-answer':
      return { class: 'bg-zinc-400 text-black', label: 'NO ANSWER' };
    case 'failed':
      return { class: 'bg-red-500 text-white', label: 'FAILED' };
    case 'voicemail':
      return { class: 'bg-purple-400 text-black', label: 'VOICEMAIL' };
  }
}

// ---- IVR Tree visual component ----

function IVRMenuNode({ menu, allMenus, depth = 0 }: { menu: IVRMenu; allMenus: IVRMenu[]; depth?: number }) {
  return (
    <div className={depth > 0 ? 'ml-8 mt-2' : ''}>
      <div className="border-2 border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {depth > 0 && (
              <div className="flex items-center">
                <div className="w-6 h-px bg-foreground/30" />
                <div className="w-2 h-2 border-2 border-foreground/30 rounded-full" />
              </div>
            )}
            <div>
              <p className="font-mono text-sm font-bold">{menu.name}</p>
              <p className="font-mono text-xs text-muted mt-0.5">&ldquo;{menu.greeting}&rdquo;</p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="border border-line px-1.5 py-0.5 uppercase text-muted">
              Timeout {menu.timeoutSeconds}s
            </span>
            <span className="border border-line px-1.5 py-0.5 uppercase text-muted">
              Retries {menu.maxRetries}
            </span>
          </div>
        </div>

        {/* Menu items */}
        <div className="mt-3 space-y-1">
          {menu.items.map((item: IVRMenuItem) => {
            const submenu = item.action === 'submenu'
              ? allMenus.find((m) => m.id === item.submenuId)
              : null;

            return (
              <div key={item.digit}>
                <div className="flex items-center gap-3 py-1">
                  <span className="flex h-6 w-6 items-center justify-center border-2 border-line bg-panel font-mono text-xs font-bold">
                    {item.digit}
                  </span>
                  <span className="font-mono text-sm font-bold">{item.label}</span>
                  <span className={`ml-auto px-2 py-0.5 font-mono text-[10px] font-bold uppercase border border-line ${
                    item.action === 'transfer'
                      ? 'bg-emerald-400/20 text-emerald-700'
                      : item.action === 'voicemail'
                        ? 'bg-purple-400/20 text-purple-700'
                        : item.action === 'submenu'
                          ? 'bg-blue-400/20 text-blue-700'
                          : 'bg-zinc-200 text-zinc-600'
                  }`}>
                    {item.action}
                  </span>
                  {item.transferTo && (
                    <span className="font-mono text-xs text-muted">{item.transferTo}</span>
                  )}
                </div>
                {submenu && (
                  <IVRMenuNode menu={submenu} allMenus={allMenus} depth={depth + 1} />
                )}
              </div>
            );
          })}
        </div>

        {/* Fallback */}
        <div className="mt-3 border-t-2 border-line pt-2">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            Fallback:
          </span>
          <span className={`ml-2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase border border-line ${
            menu.fallbackAction === 'voicemail'
              ? 'bg-purple-400/20 text-purple-700'
              : menu.fallbackAction === 'transfer'
                ? 'bg-emerald-400/20 text-emerald-700'
                : 'bg-zinc-200 text-zinc-600'
          }`}>
            {menu.fallbackAction}
          </span>
          {menu.fallbackTransferTo && (
            <span className="ml-2 font-mono text-xs text-muted">{menu.fallbackTransferTo}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Mock queue data ----

function getMockQueues(): VoiceQueueMetrics[] {
  const now = Date.now();
  return [
    {
      queueId: 'q-sales',
      name: 'Sales',
      waitingCalls: 2,
      avgWaitMs: 45000,
      longestWaitMs: 92000,
      availableAgents: 3,
      timestamp: now,
    },
    {
      queueId: 'q-support',
      name: 'Technical Support',
      waitingCalls: 5,
      avgWaitMs: 78000,
      longestWaitMs: 180000,
      availableAgents: 2,
      timestamp: now,
    },
    {
      queueId: 'q-billing',
      name: 'Billing',
      waitingCalls: 1,
      avgWaitMs: 22000,
      longestWaitMs: 22000,
      availableAgents: 1,
      timestamp: now,
    },
  ];
}

// ---- Mock call log (supplement real data with mock for demo) ----

function getMockCalls(): VoiceCall[] {
  const now = Date.now();
  return [
    {
      id: 'mock-1',
      callSid: 'CA0001',
      direction: 'inbound',
      from: '+14155559876',
      to: '+15005550006',
      status: 'completed',
      duration: 245,
      agentId: 'agent-1',
      recordingUrl: 'https://api.twilio.com/demo/recording/RE001.mp3',
      createdAt: now - 1800000,
      updatedAt: now - 1800000 + 245000,
    },
    {
      id: 'mock-2',
      callSid: 'CA0002',
      direction: 'inbound',
      from: '+447700900456',
      to: '+15005550006',
      status: 'voicemail',
      duration: 35,
      recordingUrl: 'https://api.twilio.com/demo/recording/RE002.mp3',
      createdAt: now - 3600000,
      updatedAt: now - 3600000 + 35000,
    },
    {
      id: 'mock-3',
      callSid: 'CA0003',
      direction: 'outbound',
      from: '+15005550001',
      to: '+12025551234',
      status: 'completed',
      duration: 412,
      agentId: 'agent-2',
      createdAt: now - 5400000,
      updatedAt: now - 5400000 + 412000,
    },
    {
      id: 'mock-4',
      callSid: 'CA0004',
      direction: 'inbound',
      from: '+16175559090',
      to: '+15005550006',
      status: 'no-answer',
      createdAt: now - 7200000,
      updatedAt: now - 7200000 + 30000,
    },
    {
      id: 'mock-5',
      callSid: 'CA0005',
      direction: 'inbound',
      from: '+13105558765',
      to: '+15005550006',
      status: 'in-progress',
      agentId: 'agent-1',
      createdAt: now - 300000,
      updatedAt: now,
    },
    {
      id: 'mock-6',
      callSid: 'CA0006',
      direction: 'inbound',
      from: '+19175554321',
      to: '+15005550006',
      status: 'ringing',
      createdAt: now - 15000,
      updatedAt: now,
    },
    {
      id: 'mock-7',
      callSid: 'CA0007',
      direction: 'outbound',
      from: '+15005550003',
      to: '+14085557777',
      status: 'completed',
      duration: 188,
      agentId: 'agent-3',
      createdAt: now - 10800000,
      updatedAt: now - 10800000 + 188000,
    },
    {
      id: 'mock-8',
      callSid: 'CA0008',
      direction: 'inbound',
      from: '+442071234567',
      to: '+15005550006',
      status: 'failed',
      createdAt: now - 14400000,
      updatedAt: now - 14400000 + 2000,
    },
  ];
}

// ---- Mock agents (supplement real data) ----

function getMockAgents(): VoiceAgent[] {
  return [
    { id: 'agent-1', name: 'Sarah Chen', extension: '101', phoneNumber: '+15005550001', status: 'busy', currentCallId: 'mock-5' },
    { id: 'agent-2', name: 'Mike Johnson', extension: '102', phoneNumber: '+15005550002', status: 'available' },
    { id: 'agent-3', name: 'Emma Davis', extension: '103', phoneNumber: '+15005550003', status: 'offline' },
    { id: 'agent-4', name: 'David Park', extension: '104', phoneNumber: '+15005550004', status: 'available' },
    { id: 'agent-5', name: 'Lisa Wang', extension: '105', phoneNumber: '+15005550005', status: 'wrap-up' },
    { id: 'agent-6', name: 'Tom Bradley', extension: '106', phoneNumber: '+15005550006', status: 'available' },
  ];
}

// ---- Page component ----

export default function VoiceAdminPage() {
  // Seed demo data, then get real data; fall back to mock if empty
  seedDemoData();
  const realAgents = getAgents();
  const agents = realAgents.length > 0 ? realAgents : getMockAgents();

  const realCalls = getAllCalls();
  const calls = realCalls.length > 0 ? realCalls : getMockCalls();

  const activeCalls = calls.filter(
    (c) => c.status === 'ringing' || c.status === 'in-progress',
  );

  const realQueues = getQueueMetrics();
  const queues = realQueues.length > 0 ? realQueues : getMockQueues();

  const ivrConfig = getIVRConfig();
  const mainMenu = ivrConfig.menus.find((m) => m.id === ivrConfig.mainMenuId);

  // Stats
  const availableAgents = agents.filter((a) => a.status === 'available').length;
  const avgWaitMs = queues.length > 0
    ? Math.round(queues.reduce((sum, q) => sum + q.avgWaitMs, 0) / queues.length)
    : 0;
  const callsToday = calls.length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8 sm:p-12">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <Link
              href="/dashboard/channels"
              className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted hover:text-foreground transition-colors"
            >
              Channels /
            </Link>
            <h1 className="mt-4 text-4xl font-bold">Voice Channel</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${
              activeCalls.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400'
            }`} />
            <span className="font-mono text-sm font-bold">
              {activeCalls.length} Active Call{activeCalls.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* Stat cards */}
      <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{activeCalls.length}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Active Calls
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{availableAgents}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Available Agents
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{formatMs(avgWaitMs)}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Avg Wait Time
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{callsToday}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Calls Today
          </p>
        </div>
      </section>

      {/* IVR Editor section */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">IVR Configuration</h2>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase border-2 border-line ${
              ivrConfig.enabled ? 'bg-emerald-400 text-black' : 'bg-zinc-300 text-black'
            }`}>
              {ivrConfig.enabled ? 'ENABLED' : 'DISABLED'}
            </span>
            {ivrConfig.businessHours.enabled && (
              <span className="px-2 py-0.5 font-mono text-[10px] font-bold uppercase border-2 border-line bg-blue-400/20 text-blue-700">
                BIZ HOURS
              </span>
            )}
          </div>
        </div>

        {/* IVR tree */}
        {mainMenu ? (
          <IVRMenuNode menu={mainMenu} allMenus={ivrConfig.menus} />
        ) : (
          <p className="font-mono text-sm text-muted">No IVR menu configured.</p>
        )}

        {/* Voicemail greeting */}
        <div className="mt-6 border-2 border-line p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
            Voicemail Greeting
          </p>
          <p className="font-mono text-sm text-muted italic">
            &ldquo;{ivrConfig.voicemailGreeting}&rdquo;
          </p>
        </div>

        {/* Business hours summary */}
        {ivrConfig.businessHours.enabled && (
          <div className="mt-4 border-2 border-line p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
              Business Hours ({ivrConfig.businessHours.timezone})
            </p>
            <div className="grid grid-cols-7 gap-2 font-mono text-xs">
              {Object.entries(ivrConfig.businessHours.schedule).map(([day, hours]) => (
                <div key={day} className="text-center">
                  <p className="font-bold uppercase">{day}</p>
                  <p className={hours ? 'text-foreground' : 'text-muted'}>
                    {hours ? `${hours.start}-${hours.end}` : 'Closed'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Agent phones table */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold mb-6">Agent Phones</h2>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line">
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Agent
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Extension
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Phone Number
                </th>
                <th className="pb-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const badge = agentStatusBadge(agent.status);
                return (
                  <tr key={agent.id} className="border-b border-line/50 hover:bg-accent-soft transition-colors">
                    <td className="py-3 font-bold">{agent.name}</td>
                    <td className="py-3 text-muted">{agent.extension}</td>
                    <td className="py-3 text-muted">{agent.phoneNumber}</td>
                    <td className="py-3 text-right">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${badge.class}`}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted">
                    No agents registered. Use <code className="text-foreground">cliaas voice agent register</code> to add agents.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Queue management */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold mb-6">Queue Management</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {queues.map((queue) => (
            <div key={queue.queueId} className="border-2 border-line p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="font-mono text-sm font-bold">{queue.name}</p>
                {queue.waitingCalls > 3 && (
                  <span className="px-2 py-0.5 font-mono text-[10px] font-bold uppercase border-2 border-line bg-amber-400 text-black">
                    HIGH LOAD
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="font-mono text-xl font-bold">{queue.waitingCalls}</p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Waiting
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xl font-bold">{formatMs(queue.avgWaitMs)}</p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Avg Wait
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xl font-bold">{queue.availableAgents}</p>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Agents
                  </p>
                </div>
              </div>
            </div>
          ))}
          {queues.length === 0 && (
            <p className="col-span-3 font-mono text-sm text-muted">
              No voice queues configured.
            </p>
          )}
        </div>
      </section>

      {/* Call log */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <h2 className="text-2xl font-bold mb-6">Call Log</h2>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-line">
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Time
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Dir
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  From
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  To
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Duration
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="pb-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  Agent
                </th>
                <th className="pb-3 text-right text-[10px] font-bold uppercase tracking-wider text-muted">
                  Recording
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 20).map((call) => {
                const badge = callStatusBadge(call.status);
                const agent = call.agentId
                  ? agents.find((a) => a.id === call.agentId)
                  : null;
                return (
                  <tr key={call.id} className="border-b border-line/50 hover:bg-accent-soft transition-colors">
                    <td className="py-3 text-muted whitespace-nowrap">
                      {formatTime(call.createdAt)}
                    </td>
                    <td className="py-3">
                      <span className={`font-bold ${
                        call.direction === 'inbound' ? 'text-blue-600' : 'text-emerald-600'
                      }`}>
                        {call.direction === 'inbound' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="py-3 whitespace-nowrap">{call.from}</td>
                    <td className="py-3 whitespace-nowrap">{call.to}</td>
                    <td className="py-3 text-muted">{formatDuration(call.duration)}</td>
                    <td className="py-3">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase border-2 border-line ${badge.class}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3 text-muted">{agent?.name ?? '--'}</td>
                    <td className="py-3 text-right">
                      {call.recordingUrl ? (
                        <a
                          href={call.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-foreground underline underline-offset-2 hover:text-muted transition-colors"
                        >
                          PLAY
                        </a>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted">
                    No calls recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
