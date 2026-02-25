"use client";

import { useEffect, useState } from "react";
import ProfileSection from "./ProfileSection";
import TeamSection from "./TeamSection";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  workspaceId: string;
}

export default function SettingsUserSections() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="mt-8 border-2 border-zinc-200 bg-white p-8">
        <p className="text-sm text-zinc-500">Loading profile…</p>
      </section>
    );
  }

  if (!user) return null;

  const isAdmin = user.role === "owner" || user.role === "admin";

  return (
    <>
      <ProfileSection user={user} />
      {isAdmin && <TeamSection currentUserId={user.id} />}
    </>
  );
}
