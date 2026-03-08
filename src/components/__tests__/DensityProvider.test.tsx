// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DensityProvider, useDensity } from "../DensityProvider";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// Test consumer component
function DensityDisplay() {
  const { density, setDensity } = useDensity();
  return (
    <div>
      <span data-testid="density-value">{density}</span>
      <button onClick={() => setDensity("compact")}>Set Compact</button>
      <button onClick={() => setDensity("spacious")}>Set Spacious</button>
      <button onClick={() => setDensity("comfortable")}>Set Comfortable</button>
    </div>
  );
}

describe("DensityProvider", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("defaults to comfortable", () => {
    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );
    expect(screen.getByTestId("density-value").textContent).toBe("comfortable");
  });

  it("can switch to compact mode", () => {
    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );

    fireEvent.click(screen.getByText("Set Compact"));
    expect(screen.getByTestId("density-value").textContent).toBe("compact");
  });

  it("can switch to spacious mode", () => {
    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );

    fireEvent.click(screen.getByText("Set Spacious"));
    expect(screen.getByTestId("density-value").textContent).toBe("spacious");
  });

  it("persists preference to localStorage", () => {
    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );

    fireEvent.click(screen.getByText("Set Compact"));
    expect(localStorageMock.setItem).toHaveBeenCalledWith("cliaas-density", "compact");
  });

  it("restores preference from localStorage on mount", async () => {
    localStorageMock.getItem.mockReturnValueOnce("spacious");

    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );

    // After useEffect hydration
    await vi.waitFor(() => {
      expect(screen.getByTestId("density-value").textContent).toBe("spacious");
    });
  });

  it("ignores invalid localStorage values", () => {
    localStorageMock.getItem.mockReturnValueOnce("invalid-value");

    render(
      <DensityProvider>
        <DensityDisplay />
      </DensityProvider>,
    );

    // Should remain at default after useEffect runs
    expect(screen.getByTestId("density-value").textContent).toBe("comfortable");
  });

  it("provides default context when used outside provider", () => {
    // useDensity outside provider should return defaults without crashing
    render(<DensityDisplay />);
    expect(screen.getByTestId("density-value").textContent).toBe("comfortable");
  });
});
