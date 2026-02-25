"use client";

import { useState } from "react";

interface ProfileUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export default function ProfileSection({ user }: { user: ProfileUser }) {
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  async function saveName() {
    setSaving(true);
    setNameMsg("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setNameMsg("Saved");
    } catch (err: unknown) {
      setNameMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (newPw !== confirmPw) {
      setPwMsg("Passwords do not match");
      return;
    }
    if (newPw.length < 8) {
      setPwMsg("Password must be at least 8 characters");
      return;
    }
    setPwSaving(true);
    setPwMsg("");
    try {
      const res = await fetch("/api/auth/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");
      setPwMsg("Password changed");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err: unknown) {
      setPwMsg(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white p-8">
      <h2 className="text-2xl font-bold">Profile</h2>
      <p className="mt-2 text-sm font-medium text-zinc-600">
        Manage your account information
      </p>

      {/* Name */}
      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-bold text-zinc-700">Email</label>
          <p className="mt-1 rounded border-2 border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-500">
            {user.email}
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold text-zinc-700">Name</label>
          <div className="mt-1 flex gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
            />
            <button
              onClick={saveName}
              disabled={saving || name === user.name}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {nameMsg && (
            <p className={`mt-1 text-xs font-medium ${nameMsg === "Saved" ? "text-emerald-600" : "text-red-600"}`}>
              {nameMsg}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-bold text-zinc-700">Role</label>
          <p className="mt-1 inline-block border-2 border-zinc-200 px-2 py-1 font-mono text-xs font-bold uppercase">
            {user.role}
          </p>
        </div>
      </div>

      {/* Password */}
      <div className="mt-8 border-t-2 border-zinc-200 pt-6">
        <h3 className="text-lg font-bold">Change Password</h3>
        <div className="mt-4 max-w-md space-y-3">
          <input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full border-2 border-zinc-300 px-3 py-2 text-sm focus:border-zinc-950 focus:outline-none"
          />
          <button
            onClick={changePassword}
            disabled={pwSaving || !currentPw || !newPw || !confirmPw}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {pwSaving ? "Changing…" : "Change Password"}
          </button>
          {pwMsg && (
            <p className={`text-xs font-medium ${pwMsg === "Password changed" ? "text-emerald-600" : "text-red-600"}`}>
              {pwMsg}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
