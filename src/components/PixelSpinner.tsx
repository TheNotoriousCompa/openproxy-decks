/** Spinner pixel-art 3×3: un punto luminoso orbita attorno al centro (CSS puro).
 * Stessa animazione usata dal modal PDF e dal toast di cambio stampa.
 */
export function PixelSpinner(): JSX.Element {
  // ordine orbitale delle 8 celle attorno al centro (il centro resta fisso fioco)
  const orbit = [0, 1, 2, 5, 8, 7, 6, 3];
  return (
    <div className="px-spinner" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const step = orbit.indexOf(i);
        return (
          <span
            key={i}
            className={step >= 0 ? "px-dot" : "px-dot px-center"}
            style={step >= 0 ? { animationDelay: `${-step * 0.1}s` } : undefined}
          />
        );
      })}
    </div>
  );
}
