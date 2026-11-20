import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsView } from "@/features/settings/SettingsView";
import { useSettings } from "@/stores/settings";

const usage = {
  assets: { bytes: 3 * 1024 ** 3, files: 1800 },
  exports: { bytes: 500 * 1024 ** 2, files: 12 },
  cache: { bytes: 6 * 1024 ** 3, files: 21000 },
  tmp: { bytes: 200 * 1024 ** 2, files: 80 },
  models: { bytes: 64 * 1024 ** 2, files: 1 },
  database: { bytes: 4 * 1024 ** 2, files: 1 },
  projects: 15,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_settings") return {};
    if (cmd === "storage_usage") return usage;
    if (cmd === "clear_tmp") return 200 * 1024 ** 2;
    throw new Error(`cmd ${cmd}`);
  }),
}));

vi.mock("@/services/mpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/mpc")>();
  return {
    ...actual,
    checkMpcHealth: vi.fn(),
    normalizeServer: (s: string) => s || null,
  };
});

describe("SettingsView spazio disco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettings.setState({ loaded: false });
  });

  it("righe per area + totale + pulizia tmp", async () => {
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByTestId("storage-rows")).toBeInTheDocument());
    // 3 GB + 6 GB + 0.5 GB + 0.2 GB + 64 MB + 4 MB ≈ 9.8 GB
    expect(screen.getByTestId("storage-total")).toHaveTextContent("GB");
    expect(screen.getByTestId("storage-rows")).toHaveTextContent("Artwork progetti (15)");
    expect(screen.getByTestId("storage-rows")).toHaveTextContent("Cache stampa");
    const { invoke } = await import("@tauri-apps/api/core");
    fireEvent.click(screen.getByTestId("storage-clear-tmp"));
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("clear_tmp"));
    await waitFor(() => expect(screen.getByText(/liberati/)).toBeInTheDocument());
  });

  it("senza backend: messaggio desktop-only", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return {};
      throw new Error("no backend");
    });
    render(<SettingsView />);
    await waitFor(() =>
      expect(screen.getByText("Disponibile solo nell'app desktop.")).toBeInTheDocument(),
    );
  });
});
