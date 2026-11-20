/** `{3}{B}{R}` → `3BR` per il badge costo. */
export function prettyManaCost(manaCost: string | undefined): string {
  if (!manaCost) return "";
  return manaCost.replace(/[{}]/g, "");
}
