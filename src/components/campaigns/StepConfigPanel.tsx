"use client";

import { useState, useEffect } from "react";
import type { CampaignStepType } from "@/lib/campaigns/campaign-store";

interface StepConfig {
  id: string;
  stepType: CampaignStepType;
  name: string;
  config: Record<string, unknown>;
  delaySeconds?: number;
  conditionQuery?: Record<string, unknown>;
}

interface StepConfigPanelProps {
  step: StepConfig;
  onSave: (updates: Partial<StepConfig>) => void;
  onClose: () => void;
}

export default function StepConfigPanel({ step, onSave, onClose }: StepConfigPanelProps) {
  const [name, setName] = useState(step.name);
  const [subject, setSubject] = useState((step.config.subject as string) ?? "");
  const [templateBody, setTemplateBody] = useState((step.config.templateBody as string) ?? "");
  const [delaySeconds, setDelaySeconds] = useState(step.delaySeconds ?? 3600);
  const [delayUnit, setDelayUnit] = useState<"seconds" | "minutes" | "hours" | "days">("hours");
  const [webhookUrl, setWebhookUrl] = useState((step.config.url as string) ?? "");

  useEffect(() => {
    setName(step.name);
    setSubject((step.config.subject as string) ?? "");
    setTemplateBody((step.config.templateBody as string) ?? "");
    setDelaySeconds(step.delaySeconds ?? 3600);
    setWebhookUrl((step.config.url as string) ?? "");
  }, [step]);

  function handleSave() {
    const updates: Partial<StepConfig> = { name };

    switch (step.stepType) {
      case "send_email":
        updates.config = { subject, templateBody };
        break;
      case "send_sms":
      case "send_in_app":
      case "send_push":
        updates.config = { templateBody };
        break;
      case "wait_delay": {
        const multiplier = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }[delayUnit];
        updates.delaySeconds = delaySeconds * multiplier;
        break;
      }
      case "webhook":
        updates.config = { url: webhookUrl, method: "POST" };
        break;
    }

    onSave(updates);
  }

  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold uppercase text-zinc-500">
          Configure Step
        </h3>
        <button
          onClick={onClose}
          className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
        >
          Close
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="font-mono text-xs font-bold uppercase">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        </label>

        {(step.stepType === "send_email") && (
          <>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Email subject line"
              />
            </label>
            <label className="block">
              <span className="font-mono text-xs font-bold uppercase">Body</span>
              <textarea
                value={templateBody}
                onChange={(e) => setTemplateBody(e.target.value)}
                rows={4}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                placeholder="Hi {{name}}, ..."
              />
            </label>
          </>
        )}

        {(step.stepType === "send_sms" || step.stepType === "send_in_app" || step.stepType === "send_push") && (
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Message Body</span>
            <textarea
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              rows={3}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </label>
        )}

        {step.stepType === "wait_delay" && (
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="font-mono text-xs font-bold uppercase">Duration</span>
              <input
                type="number"
                min={1}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 1)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </label>
            <label className="block w-32">
              <span className="font-mono text-xs font-bold uppercase">Unit</span>
              <select
                value={delayUnit}
                onChange={(e) => setDelayUnit(e.target.value as typeof delayUnit)}
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              >
                <option value="seconds">Seconds</option>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </label>
          </div>
        )}

        {step.stepType === "webhook" && (
          <label className="block">
            <span className="font-mono text-xs font-bold uppercase">Webhook URL</span>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              placeholder="https://..."
            />
          </label>
        )}

        <button
          onClick={handleSave}
          className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          Save Step
        </button>
      </div>
    </div>
  );
}
