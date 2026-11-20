import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArtworkImage } from "@/components/ArtworkImage";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@/services/backend", () => ({
  backend: { isTauri: true },
}));

describe("ArtworkImage fallback ibrido", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("diretto prima, backend al fallimento", async () => {
    invokeMock.mockResolvedValueOnce({ data_url: "data:image/jpeg;base64,BBB", width: 90, height: 126 });
    render(<ArtworkImage stored="https://drive/x.jpg" name="Bolt" backendThumb={false} />);
    // prima il diretto
    const direct = await screen.findByAltText("Bolt");
    expect(direct.getAttribute("src")).toBe("https://drive/x.jpg");
    expect(invokeMock).not.toHaveBeenCalled();
    // fallisce → backend
    fireEvent.error(direct);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "thumb_data_url",
      expect.objectContaining({ url: "https://drive/x.jpg" }),
    ));
    const fixed = await screen.findByAltText("Bolt");
    expect(fixed.getAttribute("src")).toBe("data:image/jpeg;base64,BBB");
  });

  it("doppio fallimento → badge diagnostico", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    render(<ArtworkImage stored="https://drive/y.jpg" name="Bolt" backendThumb={false} />);
    const direct = await screen.findByAltText("Bolt");
    fireEvent.error(direct);
    await waitFor(() => expect(screen.getByRole("button", { name: /Tocca per dettagli/ })).toBeInTheDocument());
  });
});
