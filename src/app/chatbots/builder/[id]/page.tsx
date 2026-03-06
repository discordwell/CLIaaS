"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ChatbotFlowCanvas } from "@/components/chatbot/FlowCanvas";

interface ChatbotFlow {
  id: string;
  name: string;
  nodes: Record<string, unknown>;
  rootNodeId: string;
  enabled: boolean;
  greeting?: string;
  version?: number;
  status?: string;
  channels?: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export default function ChatbotBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [flow, setFlow] = useState<ChatbotFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadFlow() {
      try {
        const res = await fetch(`/api/chatbots/${id}`);
        if (!res.ok) {
          setError("Chatbot not found");
          return;
        }
        const data = await res.json();
        setFlow(data.chatbot);
      } catch {
        setError("Failed to load chatbot");
      } finally {
        setLoading(false);
      }
    }
    loadFlow();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-100">
        <p className="font-mono text-xs text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (error || !flow) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-100 gap-4">
        <p className="font-mono text-xs text-red-600">{error || "Not found"}</p>
        <button
          onClick={() => router.push("/chatbots")}
          className="font-mono text-xs font-bold text-zinc-600 hover:text-zinc-950"
        >
          &larr; Back to Chatbots
        </button>
      </div>
    );
  }

  return (
    <ChatbotFlowCanvas
      flow={flow as Parameters<typeof ChatbotFlowCanvas>[0]["flow"]}
      onSave={async (updated) => {
        await fetch(`/api/chatbots/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
      }}
      onPublish={async (updated) => {
        // Save first, then publish
        await fetch(`/api/chatbots/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        await fetch(`/api/chatbots/${id}/publish`, { method: "POST" });
      }}
      onBack={() => router.push("/chatbots")}
    />
  );
}
