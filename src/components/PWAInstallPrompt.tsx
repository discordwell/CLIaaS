"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check localStorage for previous dismissal
    if (typeof window !== "undefined") {
      const prev = localStorage.getItem("cliaas-pwa-dismissed");
      if (prev) {
        setDismissed(true);
        return;
      }
    }

    function handlePrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handlePrompt);
    return () => window.removeEventListener("beforeinstallprompt", handlePrompt);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    localStorage.setItem("cliaas-pwa-dismissed", "1");
    setDeferredPrompt(null);
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md border-2 border-zinc-950 bg-white p-4 shadow-lg sm:left-auto sm:right-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold uppercase">
            Install CLIaaS
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Add CLIaaS to your home screen for quick access and offline support.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-zinc-400 hover:text-zinc-600"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleInstall}
          className="border-2 border-zinc-950 bg-zinc-950 px-4 py-1.5 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="border-2 border-zinc-300 px-4 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
        >
          Not Now
        </button>
      </div>
    </div>
  );
}
