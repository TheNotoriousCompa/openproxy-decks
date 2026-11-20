import { create } from "zustand";
import {
  addToCollection,
  clearCollection,
  listCollection,
  removeFromCollection,
  setCollectionQty,
  type CollectionEntry,
  type CollectionItem,
} from "@/lib/collection";

interface CollectionState {
  entries: CollectionEntry[];
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  add: (items: CollectionItem[]) => Promise<void>;
  setQty: (key: string, qty: number) => Promise<void>;
  remove: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useCollection = create<CollectionState>()((set, get) => ({
  entries: [],
  loaded: false,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      set({ entries: await listCollection(), loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (items) => {
    set({ entries: await addToCollection(get().entries, items) });
  },

  setQty: async (key, qty) => {
    set({ entries: await setCollectionQty(get().entries, key, qty) });
  },

  remove: async (key) => {
    set({ entries: await removeFromCollection(get().entries, key) });
  },

  clear: async () => {
    set({ entries: await clearCollection() });
  },
}));
