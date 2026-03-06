'use client';

import { useState, useEffect } from 'react';

interface Collaborator {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  addedAt: string;
}

export function CollaboratorPanel({ ticketId }: { ticketId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/collaborators`)
      .then(r => r.json())
      .then(data => setCollaborators(data.collaborators ?? []))
      .catch(() => {});
  }, [ticketId]);

  async function addCollaborator(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCollaborators(prev => [...prev, data.collaborator]);
        setEmail('');
      }
    } finally {
      setLoading(false);
    }
  }

  async function removeCollaborator(collaboratorId: string) {
    const res = await fetch(`/api/tickets/${ticketId}/collaborators`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collaboratorId }),
    });
    if (res.ok) {
      setCollaborators(prev => prev.filter(c => c.id !== collaboratorId));
    }
  }

  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Collaborators</h3>

      {collaborators.length === 0 ? (
        <p className="text-xs text-gray-500 mb-3">No collaborators added</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {collaborators.map(c => (
            <li key={c.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-800">{c.userName || c.userEmail || c.userId}</span>
              <button
                onClick={() => removeCollaborator(c.id)}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addCollaborator} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="flex-1 text-sm border rounded px-2 py-1"
        />
        <button
          type="submit"
          disabled={loading}
          className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}
