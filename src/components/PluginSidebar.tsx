"use client";

import { useState } from "react";

interface SidebarSlot {
  pluginId: string;
  pluginName: string;
  location: string;
  component: string;
  data?: Record<string, unknown>;
}

interface PluginSidebarProps {
  slots: SidebarSlot[];
}

export default function PluginSidebar({ slots }: PluginSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (slots.length === 0) return null;

  return (
    <div className="space-y-2">
      {slots.map((slot) => {
        const isCollapsed = collapsed[slot.pluginId] ?? false;
        return (
          <div
            key={slot.pluginId}
            className="border-2 border-zinc-950 bg-white"
          >
            <button
              onClick={() =>
                setCollapsed((prev) => ({
                  ...prev,
                  [slot.pluginId]: !isCollapsed,
                }))
              }
              className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-zinc-50"
            >
              <span className="font-mono text-xs font-bold uppercase">
                {slot.pluginName}
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {isCollapsed ? "[+]" : "[-]"}
              </span>
            </button>

            {!isCollapsed && (
              <div className="border-t border-zinc-200 p-3">
                {slot.data ? (
                  <div className="space-y-1">
                    {Object.entries(slot.data).map(([key, value]) => (
                      <div key={key} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-zinc-500">
                          {key}:
                        </span>
                        <span className="text-xs">
                          {typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-mono text-xs text-zinc-400">
                    {slot.component}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
