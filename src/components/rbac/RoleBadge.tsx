"use client";

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  admin: "bg-blue-100 text-blue-800",
  agent: "bg-zinc-100 text-zinc-700",
  light_agent: "bg-amber-100 text-amber-800",
  collaborator: "bg-teal-100 text-teal-800",
  viewer: "bg-zinc-100 text-zinc-500",
};

interface RoleBadgeProps {
  role: string;
  className?: string;
}

export default function RoleBadge({ role, className = "" }: RoleBadgeProps) {
  const colors = ROLE_COLORS[role] ?? ROLE_COLORS.agent;
  const label = role.replace(/_/g, " ");

  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${colors} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
