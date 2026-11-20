/**
 * Badge Game Changer ufficiale (Commander Brackets): punto esclamativo in un
 * cerchio rosso, come richiesto. Usato su tile/righe del DeckBuilder.
 */
export function GameChangerBadge({ name }: { name: string }): JSX.Element {
  return (
    <span
      data-testid="game-changer-badge"
      role="img"
      aria-label={`${name} è una Game Changer ufficiale Commander`}
      title="Game Changer ufficiale (Commander Brackets): conta per il bracket del mazzo"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white ring-1 ring-black/40"
    >
      !
    </span>
  );
}
