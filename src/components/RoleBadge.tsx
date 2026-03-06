'use client';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  owner: { bg: 'bg-purple-100', text: 'text-purple-800' },
  admin: { bg: 'bg-red-100', text: 'text-red-800' },
  agent: { bg: 'bg-blue-100', text: 'text-blue-800' },
  light_agent: { bg: 'bg-sky-100', text: 'text-sky-800' },
  collaborator: { bg: 'bg-amber-100', text: 'text-amber-800' },
  viewer: { bg: 'bg-gray-100', text: 'text-gray-800' },
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
  light_agent: 'Light Agent',
  collaborator: 'Collaborator',
  viewer: 'Viewer',
};

export function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] ?? ROLE_COLORS.viewer;
  const label = ROLE_LABELS[role] ?? role;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {label}
    </span>
  );
}
