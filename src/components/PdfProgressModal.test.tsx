import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PdfProgressModal } from "@/components/PdfProgressModal";

describe("PdfProgressModal", () => {
  it("nascosto quando nessun export è in corso", () => {
    const { container } = render(<PdfProgressModal progress={null} status="" />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("pdf-progress")).toBeNull();
  });

  it("box centrata con spinner 3x3 + testo italiano durante l'export", () => {
    render(<PdfProgressModal progress={0} status="Elaborazione…" />);
    const box = screen.getByTestId("pdf-progress");
    expect(box).toHaveAttribute("aria-label", "Preparazione PDF in corso");
    expect(screen.getByText("Preparazione PDF…")).toBeInTheDocument();
    // 9 celle pixel (8 orbitali + centro fisso)
    const dots = box.querySelectorAll(".px-spinner > span");
    expect(dots).toHaveLength(9);
    expect(box.querySelectorAll(".px-center")).toHaveLength(1);
    // delays orbitali sfalsati (l'animazione gira)
    const delays = [...box.querySelectorAll(".px-dot")].map(
      (el) => (el as HTMLElement).style.animationDelay,
    );
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(screen.getByText("Elaborazione…")).toBeInTheDocument();
  });

  it("dettaglio simil-vero: fase + copie + MB + ETA", () => {
    render(
      <PdfProgressModal
        progress={0.4}
        status=""
        detail={{ frac: 0.4, phase: "Elaborazione immagini…", done: 8, total: 20, etaSecs: 12, estMb: 45 }}
      />,
    );
    expect(screen.getByTestId("pdf-progress-phase")).toHaveTextContent("Elaborazione immagini…");
    expect(screen.getByTestId("pdf-progress-stats")).toHaveTextContent("8/20 copie");
    expect(screen.getByTestId("pdf-progress-stats")).toHaveTextContent("~45 MB");
    expect(screen.getByTestId("pdf-progress-stats")).toHaveTextContent("~12s rimasti");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });
});
