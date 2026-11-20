import { create } from "zustand";
import type { Project, ProjectSummary } from "@/types";
import { backend } from "@/services/backend";

export const SUMMARY_PAGE_SIZE = 20;

interface ProjectState {
  projects: Project[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  search: string;
  load: (query?: string) => Promise<void>;
  setSearch: (q: string) => void;
  create: (name: string) => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  active: () => Project | null;
  /** Lista paginata leggera per la vista Progetti (scala a centinaia di progetti). */
  summaries: ProjectSummary[];
  sumTotal: number;
  sumLoading: boolean;
  loadSummaries: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  getFull: (id: string) => Promise<Project>;
}

export const useProjects = create<ProjectState>()((set, get) => ({
  projects: [],
  activeId: (() => {
    try {
      return localStorage.getItem("proxxied.activeId");
    } catch {
      return null;
    }
  })(),
  loading: false,
  error: null,
  search: "",

  load: async (query) => {
    set({ loading: true, error: null });
    try {
      const projects = await backend.listProjects(query);
      set((s) => ({
        projects,
        loading: false,
        activeId: s.activeId && projects.some((p) => p.id === s.activeId) ? s.activeId : (projects[0]?.id ?? null),
      }));
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  setSearch: (q) => {
    set({ search: q });
    void get().load(q || undefined);
    void get().loadSummaries(true);
  },

  create: async (name) => {
    const p = await backend.createProject(name);
    set((s) => ({ projects: [p, ...s.projects], activeId: p.id }));
    try {
      localStorage.setItem("proxxied.activeId", p.id);
    } catch {
      /* ignore */
    }
    void get().loadSummaries(true);
    return p;
  },

  rename: async (id, name) => {
    const p = await backend.renameProject(id, name);
    set((s) => ({ projects: s.projects.map((x) => (x.id === id ? p : x)) }));
    void get().loadSummaries(true);
  },

  duplicate: async (id) => {
    const p = await backend.duplicateProject(id);
    set((s) => ({ projects: [p, ...s.projects] }));
    void get().loadSummaries(true);
  },

  remove: async (id) => {
    await backend.deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((x) => x.id !== id),
      activeId: s.activeId === id ? (s.projects.find((x) => x.id !== id)?.id ?? null) : s.activeId,
    }));
    void get().loadSummaries(true);
  },

  setActive: (id) => {
    set({ activeId: id });
    try {
      if (id) localStorage.setItem("proxxied.activeId", id);
      else localStorage.removeItem("proxxied.activeId");
    } catch {
      /* ignore */
    }
  },

  active: () => {
    const { projects, activeId } = get();
    return projects.find((p) => p.id === activeId) ?? null;
  },

  summaries: [],
  sumTotal: 0,
  sumLoading: false,

  loadSummaries: async (reset = false) => {
    const { search, summaries } = get();
    set({ sumLoading: true, error: null });
    try {
      const offset = reset ? 0 : summaries.length;
      const page = await backend.listSummaries(search || undefined, SUMMARY_PAGE_SIZE, offset);
      set({
        summaries: reset ? page.items : [...get().summaries, ...page.items],
        sumTotal: page.total,
        sumLoading: false,
      });
    } catch (e) {
      set({ sumLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMore: async () => {
    const { summaries, sumTotal, sumLoading } = get();
    if (sumLoading || summaries.length >= sumTotal) return;
    await get().loadSummaries(false);
  },

  getFull: (id) => backend.getProject(id),
}));
