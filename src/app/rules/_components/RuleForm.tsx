"use client";

import { useState } from "react";
import ConditionBuilder, { type ConditionRow } from "./ConditionBuilder";
import ActionBuilder, { type ActionRow } from "./ActionBuilder";
import DryRunPanel from "./DryRunPanel";

export interface RuleFormData {
  name: string;
  type: string;
  description: string;
  conditions: { all: ConditionRow[]; any: ConditionRow[] };
  actions: ActionRow[];
  enabled: boolean;
}

interface Props {
  initial?: Partial<RuleFormData>;
  ruleId?: string;
  onSubmit: (data: RuleFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

const inputClass =
  "mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950";

export default function RuleForm({
  initial,
  ruleId,
  onSubmit,
  onCancel,
  submitLabel = "Save Rule",
}: Props) {
  const [data, setData] = useState<RuleFormData>({
    name: initial?.name ?? "",
    type: initial?.type ?? "trigger",
    description: initial?.description ?? "",
    conditions: initial?.conditions ?? { all: [], any: [] },
    actions: initial?.actions ?? [],
    enabled: initial?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [showDryRun, setShowDryRun] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase">Name</span>
          <input
            type="text"
            required
            value={data.name}
            onChange={(e) => setData({ ...data, name: e.target.value })}
            className={inputClass}
            placeholder="Auto-escalate urgent"
          />
        </label>
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase">Type</span>
          <select
            value={data.type}
            onChange={(e) => setData({ ...data, type: e.target.value })}
            className={inputClass}
          >
            <option value="trigger">Trigger</option>
            <option value="macro">Macro</option>
            <option value="automation">Automation</option>
            <option value="sla">SLA</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="font-mono text-xs font-bold uppercase">Description</span>
        <input
          type="text"
          value={data.description}
          onChange={(e) => setData({ ...data, description: e.target.value })}
          className={inputClass}
          placeholder="Optional description"
        />
      </label>

      <ConditionBuilder
        group="all"
        label="Match ALL of these"
        conditions={data.conditions.all}
        onChange={(all) => setData({ ...data, conditions: { ...data.conditions, all } })}
      />

      <ConditionBuilder
        group="any"
        label="Match ANY of these"
        conditions={data.conditions.any}
        onChange={(any) => setData({ ...data, conditions: { ...data.conditions, any } })}
      />

      <ActionBuilder
        actions={data.actions}
        onChange={(actions) => setData({ ...data, actions })}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !data.name}
          className="border-2 border-zinc-950 bg-zinc-950 px-5 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={() => setShowDryRun(!showDryRun)}
          className="border-2 border-zinc-300 px-5 py-2 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
        >
          {showDryRun ? "Hide Test" : "Test"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-500 hover:text-zinc-950"
        >
          Cancel
        </button>
      </div>

      {showDryRun && (
        <DryRunPanel
          ruleData={data}
          ruleId={ruleId}
          onClose={() => setShowDryRun(false)}
        />
      )}
    </form>
  );
}
