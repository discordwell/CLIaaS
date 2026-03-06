"use client";

import { ACTION_TYPES, ACTION_VALUE_PRESETS } from "@/lib/automation/constants";

export interface ActionRow {
  type: string;
  value?: unknown;
  field?: string;
  channel?: string;
  to?: string;
  template?: string;
  url?: string;
  method?: string;
  body?: string;
}

interface Props {
  actions: ActionRow[];
  onChange: (actions: ActionRow[]) => void;
}

const selectClass =
  "w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950";
const inputClass = selectClass;

const noValueActions = ["unassign", "close", "reopen"];

export default function ActionBuilder({ actions, onChange }: Props) {
  function update(idx: number, patch: Partial<ActionRow>) {
    const next = actions.map((a, i) => (i === idx ? { ...a, ...patch } : a));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(actions.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...actions, { type: "set_status", value: "" }]);
  }

  return (
    <fieldset className="border-2 border-zinc-200 p-4">
      <legend className="px-2 font-mono text-xs font-bold uppercase text-zinc-500">
        Actions
      </legend>

      {actions.map((a, i) => {
        const presets = ACTION_VALUE_PRESETS[a.type];
        const noValue = noValueActions.includes(a.type);
        const isNotification = a.type === "send_notification";
        const isWebhook = a.type === "webhook";
        const isSetField = a.type === "set_field";

        return (
          <div key={i} className="mt-2 space-y-2 rounded border border-zinc-100 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={a.type}
                onChange={(e) => update(i, { type: e.target.value })}
                className={`${selectClass} w-44`}
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>

              {!noValue && !isNotification && !isWebhook && !isSetField && (
                presets ? (
                  <select
                    value={String(a.value ?? "")}
                    onChange={(e) => update(i, { value: e.target.value })}
                    className={`${selectClass} w-36`}
                  >
                    <option value="">—</option>
                    {presets.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={String(a.value ?? "")}
                    onChange={(e) => update(i, { value: e.target.value })}
                    className={`${inputClass} w-36`}
                    placeholder="value"
                  />
                )
              )}

              <button
                type="button"
                onClick={() => remove(i)}
                className="px-2 py-2 font-mono text-xs font-bold text-red-500 hover:text-red-700"
              >
                ✕
              </button>
            </div>

            {isSetField && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={a.field ?? ""}
                  onChange={(e) => update(i, { field: e.target.value })}
                  className={`${inputClass} w-36`}
                  placeholder="field name"
                />
                <input
                  type="text"
                  value={String(a.value ?? "")}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className={`${inputClass} w-36`}
                  placeholder="value"
                />
              </div>
            )}

            {isNotification && (
              <div className="flex gap-2">
                <select
                  value={a.channel ?? "email"}
                  onChange={(e) => update(i, { channel: e.target.value })}
                  className={`${selectClass} w-28`}
                >
                  <option value="email">email</option>
                  <option value="slack">slack</option>
                  <option value="teams">teams</option>
                  <option value="push">push</option>
                </select>
                <input
                  type="text"
                  value={a.to ?? ""}
                  onChange={(e) => update(i, { to: e.target.value })}
                  className={`${inputClass} w-44`}
                  placeholder="to (email/channel)"
                />
                <input
                  type="text"
                  value={a.template ?? ""}
                  onChange={(e) => update(i, { template: e.target.value })}
                  className={`${inputClass} w-32`}
                  placeholder="template"
                />
              </div>
            )}

            {isWebhook && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={a.url ?? ""}
                  onChange={(e) => update(i, { url: e.target.value })}
                  className={`${inputClass} w-56`}
                  placeholder="https://..."
                />
                <select
                  value={a.method ?? "POST"}
                  onChange={(e) => update(i, { method: e.target.value })}
                  className={`${selectClass} w-24`}
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="mt-3 border border-dashed border-zinc-400 px-3 py-1 font-mono text-xs text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
      >
        + action
      </button>
    </fieldset>
  );
}
