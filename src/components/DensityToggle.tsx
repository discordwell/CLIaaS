"use client";

import { useDensity, type Density } from "./DensityProvider";

const modes: { value: Density; label: string; gaps: [number, number, number] }[] = [
  { value: "spacious", label: "Spacious", gaps: [4, 12, 20] },
  { value: "comfortable", label: "Comfortable", gaps: [6, 12, 18] },
  { value: "compact", label: "Compact", gaps: [7, 12, 17] },
];

function DensityIcon({ gaps }: { gaps: [number, number, number] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1={gaps[0]} x2="21" y2={gaps[0]} />
      <line x1="3" y1={gaps[1]} x2="21" y2={gaps[1]} />
      <line x1="3" y1={gaps[2]} x2="21" y2={gaps[2]} />
    </svg>
  );
}

export default function DensityToggle() {
  const { density, setDensity } = useDensity();

  return (
    <div className="inline-flex border-2 border-zinc-950 font-mono" role="group" aria-label="Display density">
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => setDensity(mode.value)}
          title={mode.label}
          aria-pressed={density === mode.value}
          className={`flex items-center justify-center px-2 py-1.5 transition-colors ${
            density === mode.value
              ? "bg-zinc-950 text-white"
              : "bg-white text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
          }`}
        >
          <DensityIcon gaps={mode.gaps} />
        </button>
      ))}
    </div>
  );
}
