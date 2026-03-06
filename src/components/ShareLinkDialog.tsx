"use client";

import { useState } from 'react';

interface ShareLinkDialogProps {
  reportId: string;
  currentToken: string | null;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
}

export default function ShareLinkDialog({ reportId, currentToken, onClose, onToggle }: ShareLinkDialogProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = currentToken ? `${window.location.origin}/api/reports/share/${currentToken}` : null;

  function handleCopy() {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md border-2 border-zinc-950 bg-white p-6">
        <h3 className="text-lg font-bold">Share Report</h3>
        <p className="mt-2 text-sm text-zinc-600">
          {currentToken
            ? 'Anyone with this link can view this report without signing in.'
            : 'Enable sharing to generate a public link.'}
        </p>

        {shareUrl && (
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 border-2 border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs"
            />
            <button
              onClick={handleCopy}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => onToggle(!currentToken)}
            className={`border-2 px-4 py-2 font-mono text-xs font-bold uppercase ${
              currentToken
                ? 'border-red-500 text-red-600 hover:bg-red-50'
                : 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800'
            }`}
          >
            {currentToken ? 'Disable Sharing' : 'Enable Sharing'}
          </button>
          <button
            onClick={onClose}
            className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
