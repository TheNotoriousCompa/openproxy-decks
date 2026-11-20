import { useEffect, useRef } from "react";
import { TopBar } from "@/components/TopBar";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ExportToast } from "@/components/ExportToast";
import { CollectPrompt } from "@/features/collection/CollectPrompt";
import { useExportJob } from "@/stores/exportJob";
import { ProjectsView } from "@/features/projects/ProjectsView";
import { StudioView } from "@/features/studio/StudioView";
import { DeckBuilderView } from "@/features/deckbuilder/DeckBuilderView";
import { CollectionView } from "@/features/collection/CollectionView";
import { SettingsView } from "@/features/settings/SettingsView";
import { useUi } from "@/stores/ui";
import { useProjects } from "@/stores/projects";
import { useDeck } from "@/stores/deck";
import { usePrint } from "@/stores/print";
import { useSettings } from "@/stores/settings";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useTokenBoardFix } from "@/hooks/useTokenBoardFix";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/services/queryClient";
import { backend, readManifestBackup, shouldRestoreBackup } from "@/services/backend";
import { useUpdater } from "@/stores/updater";

export function App(): JSX.Element {
  const tab = useUi((s) => s.tab);
  const load = useProjects((s) => s.load);
  const collectItems = useExportJob((s) => s.collectItems);
  const setCollectItems = useExportJob((s) => s.setCollectItems);
  useUndoRedo();
  useTokenBoardFix();

  // Carica progetti all'avvio e idrata deck/print del progetto attivo (autosave-ready)
  useEffect(() => {
    void (async () => {
      // impostazioni prima di tutto: lingua preferita e server MPC servono subito
      await useSettings.getState().load();
      await load();
      const st = useProjects.getState();
      const active = st.projects.find((p) => p.id === st.activeId) ?? st.projects[0];
      if (active) {
        if (!st.activeId) st.setActive(active.id);
        // Rescue: se il backup locale è più nuovo del DB (crash/restart con save perso),
        // ripristina deck+print dal backup e risalva subito.
        const backup = readManifestBackup(active.id);
        if (shouldRestoreBackup(active.updated_at, active.manifest.deck.length, backup) && backup) {
          const rescued = {
            ...active,
            updated_at: new Date().toISOString(),
            manifest: backup.manifest,
          };
          useProjects.setState((s) => ({
            projects: s.projects.map((x) => (x.id === rescued.id ? rescued : x)),
          }));
          useDeck.getState().hydrate(backup.manifest.deck);
          usePrint.getState().hydrate(backup.manifest.print);
          void backend.saveManifest(rescued).catch(() => undefined);
          return;
        }
        useDeck.getState().hydrate(active.manifest.deck);
        usePrint.getState().hydrate(active.manifest.print);
      }
    })();
  }, []);

  // Controllo aggiornamenti silenzioso (solo desktop), dopo l'avvio.
  useEffect(() => {
    if (!backend.isTauri) return;
    const t = window.setTimeout(() => {
      void useUpdater.getState().check({ silent: true });
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  // Autosave (debounced 800ms) su ogni cambio deck/print
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const unsubDeck = useDeck.subscribe(() => queueSave());
    const unsubPrint = usePrint.subscribe(() => queueSave());
    function queueSave(): void {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const st = useProjects.getState();
        const p = st.projects.find((x) => x.id === st.activeId);
        if (!p) return;
        const updated = {
          ...p,
          updated_at: new Date().toISOString(),
          manifest: {
            version: 1 as const,
            deck: useDeck.getState().deck,
            print: {
              page: usePrint.getState().page,
              pageWmm: usePrint.getState().pageWmm,
              pageHmm: usePrint.getState().pageHmm,
              orientation: usePrint.getState().orientation,
              card: usePrint.getState().card,
              cardWmm: usePrint.getState().cardWmm,
              cardHmm: usePrint.getState().cardHmm,
              marginTopMm: usePrint.getState().marginTopMm,
              marginRightMm: usePrint.getState().marginRightMm,
              marginBottomMm: usePrint.getState().marginBottomMm,
              marginLeftMm: usePrint.getState().marginLeftMm,
              spacingRowMm: usePrint.getState().spacingRowMm,
              spacingColMm: usePrint.getState().spacingColMm,
              bleedMm: usePrint.getState().bleedMm,
              dpi: usePrint.getState().dpi,
              profile: usePrint.getState().profile,
              guides: { ...usePrint.getState().guides },
              guideColor: usePrint.getState().guideColor ?? "#00ff00",
              guideWidthPt: usePrint.getState().guideWidthPt ?? 0.75,
              guidePlacement: usePrint.getState().guidePlacement ?? "inside",
              guideLengthMm: usePrint.getState().guideLengthMm ?? 2,
              guideShape: usePrint.getState().guideShape ?? "inside",
              guideOffsetMm: usePrint.getState().guideOffsetMm ?? 0,
              guideStyle: usePrint.getState().guideStyle ?? "solid",
              guideCap: usePrint.getState().guideCap ?? "square",
              duplex: usePrint.getState().duplex,
              upscaleMode: usePrint.getState().upscaleMode,
              brightnessPct: usePrint.getState().brightnessPct ?? 0,
              includeConsidering: usePrint.getState().includeConsidering ?? true,
              backImage: usePrint.getState().backImage,
            },
          },
        };
        useProjects.setState((s) => ({
          projects: s.projects.map((x) => (x.id === updated.id ? updated : x)),
        }));
        void backend.saveManifest(updated);
      }, 800);
    }
    return () => {
      unsubDeck();
      unsubPrint();
      window.clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-full flex-col bg-black text-neutral-100">
        <TopBar />
        <UpdateBanner />
        {tab === "projects" && (
          <div className="flex-1 overflow-auto"><ProjectsView /></div>
        )}
        {tab === "settings" && (
          <div className="flex-1 overflow-auto"><SettingsView /></div>
        )}
        {tab === "studio" && <StudioView />}
        {tab === "deckbuilder" && <DeckBuilderView />}
        {tab === "collection" && (
          <div className="flex-1 overflow-auto"><CollectionView /></div>
        )}
        <ExportToast />
        {collectItems && collectItems.length > 0 && (
          <CollectPrompt
            title="Vuoi aggiungere queste carte alla tua collezione?"
            items={collectItems}
            onClose={() => setCollectItems(null)}
          />
        )}
      </div>
    </QueryClientProvider>
  );
}
