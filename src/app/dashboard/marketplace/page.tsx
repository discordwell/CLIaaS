'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MarketplaceListing {
  id: string;
  pluginId: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    category?: string;
    icon?: string;
    permissions: string[];
    hooks: string[];
    actions: Array<{ id: string; name: string; description: string }>;
  };
  status: string;
  installCount: number;
  averageRating: number | null;
  reviewCount: number;
  featured: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'All',
  'Productivity',
  'Communication',
  'Analytics',
  'AI',
  'Security',
] as const;

type Category = (typeof CATEGORIES)[number];

const ICON_COLORS = [
  'bg-emerald-400',
  'bg-blue-400',
  'bg-amber-400',
  'bg-rose-400',
  'bg-violet-400',
  'bg-cyan-400',
  'bg-orange-400',
  'bg-pink-400',
];

function iconColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ICON_COLORS[Math.abs(hash) % ICON_COLORS.length];
}

/* ------------------------------------------------------------------ */
/*  Mock data (used when API returns empty / unavailable)              */
/* ------------------------------------------------------------------ */

const MOCK_LISTINGS: MarketplaceListing[] = [
  {
    id: '1',
    pluginId: 'slack-notify',
    manifest: {
      id: 'slack-notify',
      name: 'Slack Notifications',
      version: '2.4.1',
      description:
        'Real-time ticket and SLA notifications piped directly to Slack channels. Supports thread replies, emoji reactions, and custom routing rules per channel.',
      author: 'CLIaaS Team',
      category: 'Communication',
      hooks: ['ticket.created', 'ticket.updated', 'sla.breached'],
      permissions: ['tickets:read', 'webhooks:manage'],
      actions: [],
    },
    status: 'published',
    installCount: 14_832,
    averageRating: 4.7,
    reviewCount: 342,
    featured: true,
  },
  {
    id: '2',
    pluginId: 'ai-triage',
    manifest: {
      id: 'ai-triage',
      name: 'AI Auto-Triage',
      version: '3.1.0',
      description:
        'Automatically classify, prioritize, and route incoming tickets using LLM-powered intent detection. Reduces first-response time by up to 60%.',
      author: 'CLIaaS Team',
      category: 'AI',
      hooks: ['ticket.created'],
      permissions: ['tickets:read', 'tickets:write'],
      actions: [{ id: 'triage', name: 'Triage', description: 'Auto-triage a ticket' }],
    },
    status: 'published',
    installCount: 9_421,
    averageRating: 4.9,
    reviewCount: 189,
    featured: true,
  },
  {
    id: '3',
    pluginId: 'sentiment-guard',
    manifest: {
      id: 'sentiment-guard',
      name: 'Sentiment Guard',
      version: '1.8.2',
      description:
        'Real-time sentiment analysis on every customer message. Flags escalation risks, tracks mood trends, and triggers alerts for negative shifts.',
      author: 'CLIaaS Team',
      category: 'AI',
      hooks: ['message.created', 'ticket.updated'],
      permissions: ['tickets:read', 'analytics:read'],
      actions: [],
    },
    status: 'published',
    installCount: 6_218,
    averageRating: 4.5,
    reviewCount: 97,
    featured: true,
  },
  {
    id: '4',
    pluginId: 'jira-sync',
    manifest: {
      id: 'jira-sync',
      name: 'Jira Bidirectional Sync',
      version: '2.0.3',
      description:
        'Two-way sync between CLIaaS tickets and Jira issues. Status changes, comments, and attachments propagate in both directions automatically.',
      author: 'Atlassian Labs',
      category: 'Productivity',
      hooks: ['ticket.created', 'ticket.updated', 'ticket.resolved'],
      permissions: ['tickets:read', 'tickets:write', 'oauth:external'],
      actions: [{ id: 'link', name: 'Link Issue', description: 'Link to Jira issue' }],
    },
    status: 'published',
    installCount: 11_047,
    averageRating: 4.3,
    reviewCount: 256,
    featured: false,
  },
  {
    id: '5',
    pluginId: 'pii-shield',
    manifest: {
      id: 'pii-shield',
      name: 'PII Shield',
      version: '1.2.0',
      description:
        'Automatic detection and redaction of personally identifiable information across tickets, messages, and knowledge base articles. GDPR/CCPA compliant.',
      author: 'SecureOps Inc.',
      category: 'Security',
      hooks: ['ticket.created', 'message.created', 'kb.article_created'],
      permissions: ['tickets:read', 'tickets:write', 'kb:read', 'kb:write'],
      actions: [{ id: 'scan', name: 'PII Scan', description: 'Scan content for PII' }],
    },
    status: 'published',
    installCount: 7_839,
    averageRating: 4.8,
    reviewCount: 164,
    featured: false,
  },
  {
    id: '6',
    pluginId: 'teams-bridge',
    manifest: {
      id: 'teams-bridge',
      name: 'Microsoft Teams Bridge',
      version: '1.6.4',
      description:
        'Connect CLIaaS to Microsoft Teams. Receive ticket notifications, reply from Teams, and manage assignments without leaving your chat workspace.',
      author: 'CLIaaS Team',
      category: 'Communication',
      hooks: ['ticket.created', 'ticket.assigned', 'sla.warning'],
      permissions: ['tickets:read', 'tickets:write', 'webhooks:manage'],
      actions: [],
    },
    status: 'published',
    installCount: 5_420,
    averageRating: 4.2,
    reviewCount: 88,
    featured: false,
  },
  {
    id: '7',
    pluginId: 'analytics-pro',
    manifest: {
      id: 'analytics-pro',
      name: 'Analytics Pro Dashboard',
      version: '2.2.0',
      description:
        'Advanced analytics with custom report builder, cohort analysis, agent performance heatmaps, and automated weekly digest emails.',
      author: 'DataViz Co.',
      category: 'Analytics',
      hooks: ['ticket.resolved', 'csat.submitted'],
      permissions: ['analytics:read', 'tickets:read'],
      actions: [{ id: 'report', name: 'Generate Report', description: 'Run custom analytics report' }],
    },
    status: 'published',
    installCount: 4_315,
    averageRating: 4.6,
    reviewCount: 73,
    featured: false,
  },
  {
    id: '8',
    pluginId: 'github-issues',
    manifest: {
      id: 'github-issues',
      name: 'GitHub Issues Sync',
      version: '1.4.1',
      description:
        'Link support tickets to GitHub issues. Auto-create issues from bug reports, sync status updates, and close tickets when PRs merge.',
      author: 'DevTooling Labs',
      category: 'Productivity',
      hooks: ['ticket.created', 'ticket.updated', 'ticket.resolved'],
      permissions: ['tickets:read', 'tickets:write', 'oauth:external'],
      actions: [{ id: 'create-issue', name: 'Create Issue', description: 'Create GitHub issue from ticket' }],
    },
    status: 'published',
    installCount: 8_192,
    averageRating: 4.4,
    reviewCount: 131,
    featured: false,
  },
  {
    id: '9',
    pluginId: 'auto-translate',
    manifest: {
      id: 'auto-translate',
      name: 'Auto-Translate',
      version: '1.1.0',
      description:
        'Automatic message translation for multilingual support. Detects customer language and translates agent replies in real time across 95+ languages.',
      author: 'LinguaAI',
      category: 'AI',
      hooks: ['message.created'],
      permissions: ['tickets:read', 'tickets:write'],
      actions: [],
    },
    status: 'published',
    installCount: 3_780,
    averageRating: 4.1,
    reviewCount: 52,
    featured: false,
  },
  {
    id: '10',
    pluginId: 'sla-monitor',
    manifest: {
      id: 'sla-monitor',
      name: 'SLA Monitor Pro',
      version: '2.0.1',
      description:
        'Advanced SLA tracking with predictive breach alerts, escalation chains, and real-time countdown timers on every ticket view.',
      author: 'OpsMetrics',
      category: 'Analytics',
      hooks: ['sla.breached', 'sla.warning', 'ticket.created'],
      permissions: ['tickets:read', 'analytics:read'],
      actions: [],
    },
    status: 'published',
    installCount: 5_640,
    averageRating: 4.7,
    reviewCount: 109,
    featured: false,
  },
  {
    id: '11',
    pluginId: 'audit-logger',
    manifest: {
      id: 'audit-logger',
      name: 'Compliance Audit Logger',
      version: '1.3.0',
      description:
        'Immutable audit trail for every action in your workspace. SOC 2 and ISO 27001 ready with tamper-proof export and retention policies.',
      author: 'SecureOps Inc.',
      category: 'Security',
      hooks: ['ticket.created', 'ticket.updated', 'ticket.deleted'],
      permissions: ['tickets:read', 'analytics:read'],
      actions: [{ id: 'export', name: 'Export Audit Log', description: 'Export audit trail' }],
    },
    status: 'published',
    installCount: 3_215,
    averageRating: 4.9,
    reviewCount: 41,
    featured: false,
  },
  {
    id: '12',
    pluginId: 'canned-ai',
    manifest: {
      id: 'canned-ai',
      name: 'Smart Canned Responses',
      version: '1.5.2',
      description:
        'AI-powered canned response suggestions based on ticket context. Learns from your best replies and adapts tone to match customer sentiment.',
      author: 'CLIaaS Team',
      category: 'Productivity',
      hooks: ['ticket.created', 'message.created'],
      permissions: ['tickets:read', 'kb:read'],
      actions: [{ id: 'suggest', name: 'Suggest Reply', description: 'Get AI response suggestions' }],
    },
    status: 'published',
    installCount: 6_890,
    averageRating: 4.5,
    reviewCount: 118,
    featured: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="font-mono text-xs text-muted">No ratings</span>;
  }
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={i < full ? 'text-amber-500' : 'text-zinc-300'}
        >
          {'\u2605'}
        </span>
      ))}
      <span className="ml-1 font-mono text-xs text-muted">
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function PluginIcon({ name }: { name: string }) {
  const letter = name.charAt(0).toUpperCase();
  const bg = iconColorForName(name);
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center border-2 border-line ${bg}`}
    >
      <span className="font-mono text-lg font-black text-black">{letter}</span>
    </div>
  );
}

function formatInstalls(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Featured Card                                                      */
/* ------------------------------------------------------------------ */

function FeaturedCard({
  listing,
  onInstall,
  installing,
}: {
  listing: MarketplaceListing;
  onInstall: (id: string) => void;
  installing: boolean;
}) {
  const m = listing.manifest;
  return (
    <div className="group flex flex-col border-2 border-line bg-panel transition-colors hover:bg-accent-soft">
      {/* Featured badge bar */}
      <div className="flex items-center justify-between border-b-2 border-line bg-amber-400 px-4 py-1.5">
        <span className="font-mono text-[10px] font-black uppercase tracking-widest text-black">
          Featured
        </span>
        <span className="font-mono text-[10px] font-bold uppercase text-black/60">
          v{m.version}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start gap-4">
          <PluginIcon name={m.name} />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-foreground">{m.name}</h3>
            <p className="font-mono text-xs text-muted">
              by {m.author}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-foreground/80">
          {m.description}
        </p>

        {/* Stats row */}
        <div className="mt-4 flex items-center gap-6">
          <Stars rating={listing.averageRating} />
          <span className="font-mono text-xs text-muted">
            {listing.reviewCount} reviews
          </span>
          <span className="font-mono text-xs text-muted">
            {formatInstalls(listing.installCount)} installs
          </span>
        </div>

        {/* Tags */}
        {m.category && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className="border border-line bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              {m.category}
            </span>
            {m.hooks.slice(0, 3).map((h) => (
              <span
                key={h}
                className="border border-zinc-300 px-2 py-0.5 font-mono text-[10px] text-muted"
              >
                {h}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t-2 border-line px-6 py-4">
        <Link
          href={`/marketplace/${listing.pluginId}`}
          className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
        >
          View Details
        </Link>
        <button
          onClick={() => onInstall(listing.pluginId)}
          disabled={installing}
          className="bg-emerald-400 text-black font-bold uppercase text-xs px-4 py-2 border-2 border-line disabled:opacity-50 hover:bg-emerald-300 transition-colors"
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plugin Grid Card                                                   */
/* ------------------------------------------------------------------ */

function PluginCard({
  listing,
  onInstall,
  installing,
}: {
  listing: MarketplaceListing;
  onInstall: (id: string) => void;
  installing: boolean;
}) {
  const m = listing.manifest;
  return (
    <div className="group flex flex-col border-2 border-line bg-panel transition-colors hover:bg-accent-soft">
      <div className="flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <PluginIcon name={m.name} />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-foreground leading-tight">{m.name}</h3>
            <p className="font-mono text-[11px] text-muted">
              v{m.version} &middot; {m.author}
            </p>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 text-sm leading-relaxed text-foreground/70 line-clamp-2">
          {m.description}
        </p>

        {/* Tags */}
        <div className="mt-3 flex flex-wrap gap-1">
          {m.category && (
            <span className="border border-line bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              {m.category}
            </span>
          )}
          {m.hooks.slice(0, 2).map((h) => (
            <span
              key={h}
              className="border border-zinc-300 px-2 py-0.5 font-mono text-[10px] text-muted"
            >
              {h}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="mt-auto pt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Stars rating={listing.averageRating} />
            <span className="font-mono text-[10px] text-muted">
              ({listing.reviewCount})
            </span>
          </div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            {formatInstalls(listing.installCount)} installs
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t-2 border-line px-5 py-3">
        <Link
          href={`/marketplace/${listing.pluginId}`}
          className="font-mono text-xs font-bold uppercase tracking-wider text-muted hover:text-foreground"
        >
          Details
        </Link>
        <button
          onClick={() => onInstall(listing.pluginId)}
          disabled={installing}
          className="bg-emerald-400 text-black font-bold uppercase text-xs px-4 py-2 border-2 border-line disabled:opacity-50 hover:bg-emerald-300 transition-colors"
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function MarketplaceBrowsePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [installing, setInstalling] = useState<string | null>(null);

  /* --- Fetch listings -------------------------------------------- */

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category !== 'All') params.set('category', category);

      const res = await fetch(`/api/marketplace?${params}`);
      const data = await res.json();
      const fetched: MarketplaceListing[] = data.listings || [];

      // Use mock data when API returns empty (no DB / no published listings yet)
      setListings(fetched.length > 0 ? fetched : MOCK_LISTINGS);
    } catch {
      setListings(MOCK_LISTINGS);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  /* --- Install handler ------------------------------------------- */

  async function handleInstall(pluginId: string) {
    setInstalling(pluginId);
    try {
      const res = await fetch(`/api/marketplace/${pluginId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await loadListings();
      }
    } finally {
      setInstalling(null);
    }
  }

  /* --- Derived data ---------------------------------------------- */

  const filtered = useMemo(() => {
    let result = listings;
    if (category !== 'All') {
      result = result.filter(
        (l) => l.manifest.category === category,
      );
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.manifest.name.toLowerCase().includes(term) ||
          l.manifest.description.toLowerCase().includes(term) ||
          l.manifest.author.toLowerCase().includes(term),
      );
    }
    return result;
  }, [listings, category, search]);

  const featured = useMemo(
    () => filtered.filter((l) => l.featured),
    [filtered],
  );

  const grid = useMemo(
    () => filtered.filter((l) => !l.featured),
    [filtered],
  );

  const totalInstalls = useMemo(
    () => listings.reduce((sum, l) => sum + l.installCount, 0),
    [listings],
  );

  /* --- Render ---------------------------------------------------- */

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 text-foreground">
      {/* ---- Header ---- */}
      <header className="border-2 border-line bg-panel p-8 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
              Plugin Ecosystem
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight">
              Marketplace
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-foreground/70">
              Extend CLIaaS with integrations, automations, and AI-powered tools.
              Browse {listings.length} plugins from the community and first-party catalog.
            </p>
          </div>
          {/* Search */}
          <div className="w-full sm:w-80">
            <input
              type="text"
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border-2 border-line bg-panel px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
          </div>
        </div>
      </header>

      {/* ---- Stats bar ---- */}
      <section className="mt-6 grid grid-cols-3 gap-4">
        <div className="border-2 border-line bg-panel p-4 text-center">
          <p className="font-mono text-2xl font-bold">{listings.length}</p>
          <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
            Plugins
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-4 text-center">
          <p className="font-mono text-2xl font-bold">{formatInstalls(totalInstalls)}</p>
          <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
            Total Installs
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-4 text-center">
          <p className="font-mono text-2xl font-bold">{CATEGORIES.length - 1}</p>
          <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">
            Categories
          </p>
        </div>
      </section>

      {/* ---- Category Filter ---- */}
      <section className="mt-6 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              category === cat
                ? 'border-line bg-foreground text-panel'
                : 'border-line bg-panel text-muted hover:bg-accent-soft hover:text-foreground'
            }`}
          >
            {cat}
          </button>
        ))}
      </section>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="mt-10 border-2 border-line bg-panel p-12 text-center">
          <div className="mx-auto h-6 w-6 animate-spin border-2 border-line border-t-transparent" />
          <p className="mt-4 font-mono text-xs font-bold uppercase tracking-widest text-muted">
            Loading Marketplace
          </p>
        </div>
      )}

      {/* ---- Empty state ---- */}
      {!loading && filtered.length === 0 && (
        <div className="mt-10 border-2 border-line bg-panel p-12 text-center">
          <p className="text-2xl font-bold">No plugins found</p>
          <p className="mt-2 text-sm text-muted">
            Try adjusting your search or category filter.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setCategory('All');
            }}
            className="mt-4 border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* ---- Featured Section ---- */}
      {!loading && featured.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">Featured</h2>
            <span className="border-2 border-amber-400 bg-amber-400/10 px-2.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-amber-600">
              Curated
            </span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((listing) => (
              <FeaturedCard
                key={listing.pluginId}
                listing={listing}
                onInstall={handleInstall}
                installing={installing === listing.pluginId}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---- Plugin Grid ---- */}
      {!loading && grid.length > 0 && (
        <section className={featured.length > 0 ? 'mt-10' : 'mt-10'}>
          <h2 className="text-2xl font-bold">
            {category === 'All' ? 'All Plugins' : category}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted">
            {grid.length} plugin{grid.length !== 1 ? 's' : ''} available
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grid.map((listing) => (
              <PluginCard
                key={listing.pluginId}
                listing={listing}
                onInstall={handleInstall}
                installing={installing === listing.pluginId}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---- Footer CTA ---- */}
      {!loading && (
        <section className="mt-12 border-2 border-line bg-zinc-950 p-8 text-zinc-100">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white">Build Your Own Plugin</h3>
              <p className="mt-1 font-mono text-xs text-zinc-500">
                Publish to the marketplace and reach thousands of CLIaaS workspaces.
              </p>
            </div>
            <div className="flex gap-3">
              <span className="border-2 border-zinc-700 px-4 py-2 font-mono text-xs font-bold uppercase text-zinc-400">
                cliaas plugin init
              </span>
              <Link
                href="/integrations"
                className="border-2 border-emerald-400 bg-emerald-400 px-4 py-2 font-mono text-xs font-bold uppercase text-black hover:bg-emerald-300 transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
