"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Density = "spacious" | "comfortable" | "compact";

interface DensityContextValue {
  density: Density;
  setDensity: (d: Density) => void;
}

const STORAGE_KEY = "cliaas-density";
const DEFAULT_DENSITY: Density = "comfortable";

const DensityContext = createContext<DensityContextValue>({
  density: DEFAULT_DENSITY,
  setDensity: () => {},
});

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "spacious" || stored === "comfortable" || stored === "compact") {
        setDensityState(stored);
      }
    } catch {
      // localStorage unavailable (SSR, private mode, etc.)
    }
  }, []);

  const setDensity = (d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(STORAGE_KEY, d);
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <DensityContext.Provider value={{ density, setDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity(): DensityContextValue {
  return useContext(DensityContext);
}
