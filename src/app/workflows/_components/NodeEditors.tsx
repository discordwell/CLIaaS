"use client";

import { TICKET_EVENTS } from "@/lib/automation/constants";
import type { WorkflowNode, WorkflowCondition, WorkflowAction } from "./types";
import { nodeTypeConfig } from "./types";
import { ConditionRows } from "./ConditionRows";
import { ActionRows } from "./ActionRows";

export function NodeEditor({
  node,
  isEntry,
  onChange,
  onSetEntry,
}: {
  node: WorkflowNode;
  isEntry: boolean;
  onChange: (updated: WorkflowNode) => void;
  onSetEntry: () => void;
}) {
  const cfg = nodeTypeConfig[node.type];

  function updateData(patch: Record<string, unknown>) {
    onChange({ ...node, data: { ...node.data, ...patch } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded text-xs text-white ${cfg.color}`}
        >
          {cfg.icon}
        </span>
        <span className="font-mono text-xs font-bold uppercase">
          {cfg.label} Node
        </span>
      </div>

      {!isEntry && node.type === "trigger" && (
        <button
          onClick={onSetEntry}
          className="w-full border-2 border-amber-400 px-3 py-1 font-mono text-[10px] font-bold uppercase text-amber-600 hover:bg-amber-50"
        >
          Set as Entry
        </button>
      )}

      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          ID
        </label>
        <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">
          {node.id}
        </p>
      </div>

      {node.type === "trigger" && (
        <TriggerEditor
          data={node.data as { event?: string; conditions?: WorkflowCondition[] }}
          onChange={updateData}
        />
      )}
      {node.type === "state" && (
        <StateEditor
          data={
            node.data as {
              label?: string;
              color?: string;
              slaMinutes?: number;
              mandatoryFields?: string[];
              onEnterActions?: WorkflowAction[];
            }
          }
          onChange={updateData}
        />
      )}
      {node.type === "condition" && (
        <ConditionEditor
          data={
            node.data as {
              logic?: string;
              conditions?: WorkflowCondition[];
            }
          }
          onChange={updateData}
        />
      )}
      {node.type === "action" && (
        <ActionEditor
          data={node.data as { actions?: WorkflowAction[] }}
          onChange={updateData}
        />
      )}
      {node.type === "delay" && (
        <DelayEditor
          data={
            node.data as { type?: string; minutes?: number; event?: string }
          }
          onChange={updateData}
        />
      )}
      {node.type === "end" && (
        <EndEditor
          data={node.data as { label?: string }}
          onChange={updateData}
        />
      )}
    </div>
  );
}

function TriggerEditor({
  data,
  onChange,
}: {
  data: { event?: string; conditions?: WorkflowCondition[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Event
        </label>
        <select
          value={data.event || "create"}
          onChange={(e) => onChange({ event: e.target.value })}
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        >
          {TICKET_EVENTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>
      <ConditionRows
        label="Entry Conditions"
        conditions={data.conditions || []}
        onChange={(conditions) => onChange({ conditions })}
      />
    </div>
  );
}

function StateEditor({
  data,
  onChange,
}: {
  data: {
    label?: string;
    color?: string;
    slaMinutes?: number;
    mandatoryFields?: string[];
    onEnterActions?: WorkflowAction[];
  };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-purple-500",
    "bg-red-500",
    "bg-teal-500",
    "bg-pink-500",
    "bg-zinc-400",
  ];

  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Label
        </label>
        <input
          type="text"
          value={data.label || ""}
          onChange={(e) => onChange({ label: e.target.value })}
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Color
        </label>
        <div className="mt-1 flex flex-wrap gap-1">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ color: c })}
              className={`h-5 w-5 rounded-sm ${c} ${
                data.color === c
                  ? "ring-2 ring-zinc-950 ring-offset-1"
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          SLA (minutes)
        </label>
        <input
          type="number"
          value={data.slaMinutes || ""}
          onChange={(e) =>
            onChange({
              slaMinutes: e.target.value ? parseInt(e.target.value) : undefined,
            })
          }
          placeholder="e.g. 60"
          className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
        />
      </div>
      <ActionRows
        label="On-Enter Actions"
        actions={data.onEnterActions || []}
        onChange={(onEnterActions) => onChange({ onEnterActions })}
      />
    </div>
  );
}

function ConditionEditor({
  data,
  onChange,
}: {
  data: { logic?: string; conditions?: WorkflowCondition[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Logic
        </label>
        <div className="mt-1 flex gap-2">
          {(["all", "any"] as const).map((l) => (
            <button
              key={l}
              onClick={() => onChange({ logic: l })}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${
                data.logic === l
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 text-zinc-500"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <ConditionRows
        label="Conditions"
        conditions={data.conditions || []}
        onChange={(conditions) => onChange({ conditions })}
      />
    </div>
  );
}

function ActionEditor({
  data,
  onChange,
}: {
  data: { actions?: WorkflowAction[] };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <ActionRows
      label="Actions"
      actions={data.actions || []}
      onChange={(actions) => onChange({ actions })}
    />
  );
}

function DelayEditor({
  data,
  onChange,
}: {
  data: { type?: string; minutes?: number; event?: string };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
          Delay Type
        </label>
        <div className="mt-1 flex gap-2">
          {(["time", "event"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ type: t })}
              className={`border px-3 py-1 font-mono text-xs font-bold uppercase ${
                data.type === t
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 text-zinc-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {data.type === "time" ? (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Minutes
          </label>
          <input
            type="number"
            value={data.minutes || ""}
            onChange={(e) =>
              onChange({ minutes: parseInt(e.target.value) || 0 })
            }
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          />
        </div>
      ) : (
        <div>
          <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
            Wait for Event
          </label>
          <select
            value={data.event || "reply"}
            onChange={(e) => onChange({ event: e.target.value })}
            className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
          >
            {TICKET_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function EndEditor({
  data,
  onChange,
}: {
  data: { label?: string };
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] font-bold uppercase text-zinc-500">
        Label
      </label>
      <input
        type="text"
        value={data.label || ""}
        onChange={(e) => onChange({ label: e.target.value })}
        className="mt-1 w-full border border-zinc-300 px-2 py-1 font-mono text-xs focus:border-zinc-950 focus:outline-none"
      />
    </div>
  );
}
