import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CellLoadingOverlay, PrintBusyToast } from "@/components/PrintBusyToast";

describe("conferma cambio stampa (in basso)", () => {
  it("niente durante il download: il caricamento si vede sulla carta", () => {
    const { container } = render(
      <PrintBusyToast job={{ name: "Swamp", count: 1, startedAt: Date.now(), phase: "saving" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("mostra la spunta a download finito, con nome e copie", () => {
    render(
      <PrintBusyToast job={{ name: "Command Tower", count: 3, startedAt: Date.now(), phase: "done" }} />,
    );
    const box = screen.getByTestId("print-busy");
    expect(screen.getByText("Stampa applicata")).toBeInTheDocument();
    expect(screen.getByText(/Command Tower · 3 copie/)).toBeInTheDocument();
    expect(box.querySelector(".px-done")).not.toBeNull();
    // non blocca l'uso dell'app
    expect(box.className).toContain("pointer-events-none");
    // niente spinner/barra qui: quelli stanno sulla carta
    expect(box.querySelector(".px-spinner")).toBeNull();
    expect(box.querySelector(".px-bar")).toBeNull();
  });

  it("una sola copia non mostra il conteggio", () => {
    render(<PrintBusyToast job={{ name: "Swamp", count: 1, startedAt: Date.now(), phase: "done" }} />);
    expect(screen.getByText("Swamp")).toBeInTheDocument();
    expect(screen.queryByText(/copie/)).toBeNull();
  });
});

describe("spinner sopra la carta in aggiornamento", () => {
  it("mostra l'animazione pixel-art dentro la cella, senza bloccare i click", () => {
    render(<CellLoadingOverlay label="Preparazione stampa per Swamp" />);
    const box = screen.getByTestId("cell-loading");
    expect(box.className).toContain("pointer-events-none");
    expect(box.className).toContain("absolute");
    expect(box).toHaveAttribute("aria-label", "Preparazione stampa per Swamp");
    // 9 celle dello spinner 3×3
    expect(box.querySelectorAll(".px-spinner > span")).toHaveLength(9);
  });
});
