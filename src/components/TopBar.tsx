import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useUi, type Tab } from "@/stores/ui";
import { useProjects } from "@/stores/projects";
import { backend } from "@/services/backend";

const TABS: { id: Tab; label: string }[] = [
  { id: "projects", label: "Progetti" },
  { id: "studio", label: "Studio" },
  { id: "deckbuilder", label: "DeckBuilder" },
  { id: "collection", label: "Collezione" },
  { id: "settings", label: "Impostazioni" },
];

export function TopBar(): JSX.Element {
  const { tab, setTab } = useUi();
  const activeId = useProjects((s) => s.activeId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMsg, setMenuMsg] = useState("");

  const openFolder = async (which: "assets" | "exports"): Promise<void> => {
    setMenuOpen(false);
    if (!activeId) {
      setMenuMsg("Apri un progetto per vedere le sue cartelle.");
      return;
    }
    if (!backend.isTauri) {
      setMenuMsg("Le cartelle si aprono solo nell'app desktop.");
      return;
    }
    try {
      const folders = await backend.projectFolders(activeId);
      await open(which === "assets" ? folders.assets : folders.exports);
      setMenuMsg("");
    } catch (e) {
      setMenuMsg(`Apertura non riuscita: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <header className="panel flex h-12 shrink-0 items-center gap-1 border-b thin-border px-3" role="banner">
      <div className="mr-4 text-sm font-bold tracking-wide" aria-label="OpenProxy & Decks">
        OpenProxy &amp; Decks
      </div>
      <nav className="flex gap-1" aria-label="Sezioni principali">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setMenuOpen(false);
              setTab(t.id);
            }}
            aria-pressed={tab === t.id}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t.id ? "bg-neutral-200 text-black" : "text-neutral-300 hover:bg-neutral-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="relative ml-2">
        <button
          type="button"
          onClick={() => {
            setMenuMsg("");
            setMenuOpen((v) => !v);
          }}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          title={activeId ? "Apri le cartelle del progetto attivo" : "Apri un progetto per vedere le sue cartelle"}
          className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          Visualizza ▾
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Cartelle progetto"
            className="panel-2 thin-border absolute left-0 top-full z-50 mt-1 w-52 rounded p-1"
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenuOpen(false);
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void openFolder("assets")}
              disabled={!activeId}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-900 disabled:opacity-40"
            >
              Cartella immagini
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void openFolder("exports")}
              disabled={!activeId}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-900 disabled:opacity-40"
            >
              Cartella PDF
            </button>
            {!activeId && (
              <p className="px-2 py-1 text-[11px] text-neutral-500">Apri un progetto per abilitare.</p>
            )}
          </div>
        )}
      </div>
      {menuMsg && (
        <p className="ml-2 text-xs text-neutral-400" role="status">
          {menuMsg}
        </p>
      )}
    </header>
  );
}
