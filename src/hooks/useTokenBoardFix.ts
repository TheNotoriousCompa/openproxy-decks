import { useEffect, useRef } from "react";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import {
  boundedSignal,
  fixTokensBoard,
  isTokenBoardFixed,
  markTokenBoardFixed,
} from "@/services/zonefix";

/**
 * Ripulisce una volta sola il board Token del progetto attivo: Moxfield ci
 * mette anche i token-copia come carte vere (creature, istantanei…), che
 * quindi non vanno stampati né elencati tra i token. La classificazione usa
 * Scryfall (layout token/emblem + supertipo «Token»).
 *
 * Una rimozione = un solo passo di Undo (`bulkRemove`), così si recupera
 * subito se serve.
 */
export function useTokenBoardFix(): void {
  const projectId = useProjects((s) => s.activeId);
  const deck = useDeck((s) => s.deck);
  const running = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || deck.length === 0 || isTokenBoardFixed(projectId)) return;
    if (running.current === projectId) return;
    running.current = projectId;
    let cancelled = false;
    const { signal, cancel } = boundedSignal(6000);
    void (async () => {
      const { drop, ok } = await fixTokensBoard(useDeck.getState().deck, signal).finally(cancel);
      running.current = null;
      if (cancelled) return;
      if (ok) markTokenBoardFixed(projectId);
      if (drop.length > 0) useDeck.getState().bulkRemove(drop);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, deck]);
}

/**
 * Stessa pulizia ma su richiesta esplicita (prima di un export): deterministica,
 * con scadenza, e no-op dal secondo giro in poi (flag per progetto).
 * Ritorna quante voci ha rimosso.
 */
export async function ensureActiveTokenBoardFixed(opts?: { timeoutMs?: number }): Promise<number> {
  const projectId = useProjects.getState().activeId;
  if (!projectId || isTokenBoardFixed(projectId)) return 0;
  const { signal, cancel } = boundedSignal(opts?.timeoutMs ?? 6000);
  const { drop, ok } = await fixTokensBoard(useDeck.getState().deck, signal).finally(cancel);
  if (ok) markTokenBoardFixed(projectId);
  if (drop.length > 0) useDeck.getState().bulkRemove(drop);
  return drop.length;
}
