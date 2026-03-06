"use client";

import { useState } from "react";
import type { CampaignStepType } from "@/lib/campaigns/campaign-store";
import StepCard from "./StepCard";
import StepConfigPanel from "./StepConfigPanel";

interface StepData {
  id: string;
  stepType: CampaignStepType;
  position: number;
  name: string;
  config: Record<string, unknown>;
  delaySeconds?: number;
  conditionQuery?: Record<string, unknown>;
}

interface StepEditorProps {
  campaignId: string;
  steps: StepData[];
  onAddStep: (stepType: CampaignStepType, position: number) => void;
  onUpdateStep: (stepId: string, updates: Partial<StepData>) => void;
  onDeleteStep: (stepId: string) => void;
  onReorder: (stepIds: string[]) => void;
  disabled?: boolean;
}

const STEP_TYPES: { type: CampaignStepType; label: string; icon: string }[] = [
  { type: "send_email", label: "Email", icon: "mail" },
  { type: "send_sms", label: "SMS", icon: "sms" },
  { type: "send_in_app", label: "In-App", icon: "app" },
  { type: "send_push", label: "Push", icon: "push" },
  { type: "wait_delay", label: "Delay", icon: "wait" },
  { type: "wait_event", label: "Event", icon: "event" },
  { type: "condition", label: "Condition", icon: "if" },
  { type: "branch", label: "Branch", icon: "branch" },
  { type: "update_tag", label: "Tag", icon: "tag" },
  { type: "webhook", label: "Webhook", icon: "hook" },
];

export default function StepEditor({
  steps,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
  disabled,
}: StepEditorProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showAddAt, setShowAddAt] = useState<number | null>(null);

  const selectedStep = steps.find((s) => s.id === selectedStepId);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Step List */}
      <div className="space-y-2">
        {steps.length === 0 && (
          <div className="border-2 border-dashed border-zinc-300 p-8 text-center">
            <p className="font-mono text-sm text-zinc-500">
              No steps yet. Add the first step to begin building your campaign flow.
            </p>
          </div>
        )}

        {steps.map((step, i) => (
          <div key={step.id}>
            {/* Connector line + add button above */}
            {i > 0 && (
              <div className="flex flex-col items-center py-1">
                <div className="h-4 w-px bg-zinc-300" />
                {!disabled && (
                  <button
                    onClick={() => setShowAddAt(showAddAt === i ? null : i)}
                    className="flex h-5 w-5 items-center justify-center border border-zinc-300 bg-white text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-700"
                    title="Add step here"
                  >
                    +
                  </button>
                )}
                <div className="h-4 w-px bg-zinc-300" />
              </div>
            )}

            {/* Insert point type picker */}
            {showAddAt === i && !disabled && (
              <div className="mb-2 border-2 border-dashed border-blue-300 bg-blue-50 p-3">
                <p className="mb-2 font-mono text-xs font-bold uppercase text-blue-600">
                  Insert Step
                </p>
                <div className="flex flex-wrap gap-1">
                  {STEP_TYPES.map((st) => (
                    <button
                      key={st.type}
                      onClick={() => {
                        onAddStep(st.type, i);
                        setShowAddAt(null);
                      }}
                      className="border border-blue-300 bg-white px-2 py-1 font-mono text-xs hover:bg-blue-100"
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <StepCard
              id={step.id}
              stepType={step.stepType}
              name={step.name}
              position={step.position}
              delaySeconds={step.delaySeconds}
              isSelected={selectedStepId === step.id}
              onSelect={() => setSelectedStepId(selectedStepId === step.id ? null : step.id)}
              onDelete={() => {
                onDeleteStep(step.id);
                if (selectedStepId === step.id) setSelectedStepId(null);
              }}
            />
          </div>
        ))}

        {/* Add step at end */}
        {!disabled && (
          <div className="flex flex-col items-center py-1">
            {steps.length > 0 && <div className="h-4 w-px bg-zinc-300" />}
            <div className="w-full border-2 border-dashed border-zinc-300 p-3">
              <p className="mb-2 text-center font-mono text-xs font-bold uppercase text-zinc-500">
                Add Step
              </p>
              <div className="flex flex-wrap justify-center gap-1">
                {STEP_TYPES.map((st) => (
                  <button
                    key={st.type}
                    onClick={() => onAddStep(st.type, steps.length)}
                    className="border border-zinc-300 bg-white px-2 py-1 font-mono text-xs hover:border-zinc-500 hover:bg-zinc-50"
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Config Panel */}
      <div>
        {selectedStep ? (
          <StepConfigPanel
            step={selectedStep}
            onSave={(updates) => {
              onUpdateStep(selectedStep.id, updates);
            }}
            onClose={() => setSelectedStepId(null)}
          />
        ) : (
          <div className="border-2 border-dashed border-zinc-200 p-6 text-center">
            <p className="font-mono text-xs text-zinc-400">
              Select a step to configure it
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
