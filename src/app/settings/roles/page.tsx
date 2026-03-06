import RoleManagement from "@/components/rbac/RoleManagement";

export default function RolesSettingsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-black uppercase tracking-tight">
        Role Management
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        View and manage role permissions
      </p>
      <div className="mt-8">
        <RoleManagement />
      </div>
    </div>
  );
}
