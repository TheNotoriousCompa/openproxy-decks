import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useUpdater } from "@/stores/updater";
import { UpdateBanner } from "@/components/UpdateBanner";

const { checkMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(async () => undefined),
}));

vi.mock("@/services/backend", () => ({ backend: { isTauri: true } }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));

function fakeUpdate(version: string, events: boolean): {
  version: string;
  body: string;
  downloadAndInstall: ReturnType<typeof vi.fn>;
} {
  return {
    version,
    body: "Note di rilascio",
    downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
      if (!events) return;
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 40 } });
      cb({ event: "Progress", data: { chunkLength: 60 } });
      cb({ event: "Finished" });
    }),
  };
}

describe("updater store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdater.setState({
      status: "idle",
      version: null,
      notes: null,
      progress: null,
      error: null,
      dismissed: false,
    });
  });

  it("nessun aggiornamento → uptodate", async () => {
    checkMock.mockResolvedValueOnce(null);
    await useUpdater.getState().check();
    expect(useUpdater.getState().status).toBe("uptodate");
  });

  it("aggiornamento disponibile → available con versione e note", async () => {
    checkMock.mockResolvedValueOnce(fakeUpdate("0.2.0", true));
    await useUpdater.getState().check();
    const s = useUpdater.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("0.2.0");
    expect(s.notes).toBe("Note di rilascio");
  });

  it("download: progresso fino a ready", async () => {
    checkMock.mockResolvedValueOnce(fakeUpdate("0.2.0", true));
    await useUpdater.getState().check();
    await useUpdater.getState().install();
    expect(useUpdater.getState().status).toBe("ready");
    expect(useUpdater.getState().progress).toBe(1);
  });

  it("errore silenzioso all'avvio: nessun errore mostrato", async () => {
    checkMock.mockRejectedValueOnce(new Error("offline"));
    await useUpdater.getState().check({ silent: true });
    expect(useUpdater.getState().status).toBe("idle");
    expect(useUpdater.getState().error).toBeNull();
  });

  it("errore manuale → error con messaggio", async () => {
    checkMock.mockRejectedValueOnce(new Error("rete assente"));
    await useUpdater.getState().check();
    expect(useUpdater.getState().status).toBe("error");
    expect(useUpdater.getState().error).toBe("rete assente");
  });

  it("relaunch delega al plugin process", async () => {
    await useUpdater.getState().relaunch();
    expect(relaunchMock).toHaveBeenCalled();
  });
});

describe("UpdateBanner", () => {
  beforeEach(() => {
    useUpdater.setState({
      status: "idle",
      version: null,
      notes: null,
      progress: null,
      error: null,
      dismissed: false,
    });
  });

  it("disponibile: mostra versione e installa; 'Più tardi' la chiude", () => {
    useUpdater.setState({ status: "available", version: "0.2.0" });
    render(<UpdateBanner />);
    expect(screen.getByTestId("update-banner")).toHaveTextContent("Aggiornamento 0.2.0 disponibile");
    expect(screen.getByTestId("update-install")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("update-dismiss"));
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("download: percentuale e niente dismiss", () => {
    useUpdater.setState({ status: "downloading", version: "0.2.0", progress: 0.4 });
    render(<UpdateBanner />);
    expect(screen.getByTestId("update-banner")).toHaveTextContent("40%");
    expect(screen.queryByTestId("update-dismiss")).toBeNull();
  });

  it("pronto: bottone Riavvia", () => {
    useUpdater.setState({ status: "ready", version: "0.2.0", progress: 1 });
    render(<UpdateBanner />);
    expect(screen.getByTestId("update-relaunch")).toBeInTheDocument();
  });

  it("idle: nessun banner", () => {
    render(<UpdateBanner />);
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });
});
