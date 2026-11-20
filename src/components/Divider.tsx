import { useRef } from "react";

export function Divider({ onDrag }: { onDrag: (dx: number) => void }): JSX.Element {
  const startX = useRef(0);
  const dragging = useRef(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ridimensiona pannello"
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize bg-black hover:bg-neutral-800 focus:bg-neutral-700"
      onMouseDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        const move = (ev: MouseEvent): void => {
          if (!dragging.current) return;
          onDrag(ev.clientX - startX.current);
          startX.current = ev.clientX;
        };
        const up = (): void => {
          dragging.current = false;
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onDrag(-10);
        if (e.key === "ArrowRight") onDrag(10);
      }}
    />
  );
}
