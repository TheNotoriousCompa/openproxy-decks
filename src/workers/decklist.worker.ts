/// <reference lib="webworker" />
import { parseDeckList } from "@/lib/decklist";

self.onmessage = (e: MessageEvent<{ text: string }>): void => {
  try {
    const result = parseDeckList(e.data.text);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

export {};
