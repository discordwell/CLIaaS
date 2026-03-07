'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  currentState: 'closed' | 'open' | 'half_open';
}

export default function SafetyActions({ currentState }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function trip() {
    setLoading(true);
    try {
      // Record 5 failures to trip the breaker
      for (let i = 0; i < 6; i++) {
        await fetch('/api/ai/admin', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'record_failure',
            error: 'Manual trip from safety dashboard',
          }),
        });
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    setLoading(true);
    try {
      await fetch('/api/ai/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_circuit_breaker' }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 ml-auto">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
        Manual Override
      </p>
      <div className="flex gap-3">
        <button
          onClick={trip}
          disabled={loading || currentState === 'open'}
          className="border-2 border-line bg-red-500 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? '...' : 'Trip'}
        </button>
        <button
          onClick={reset}
          disabled={loading || currentState === 'closed'}
          className="border-2 border-line bg-emerald-500 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? '...' : 'Reset'}
        </button>
      </div>
    </div>
  );
}
