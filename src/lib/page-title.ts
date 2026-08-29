const STATIC_PAGE_TITLES = new Map<string, string>([
  ["/", "Dashboard"],
  ["/__design", "Design Lab"],
  ["/documenti", "Documenti"],
  ["/impostazioni", "Impostazioni"],
  ["/login", "Accedi"],
  ["/pratiche", "Pratiche"],
  ["/setup", "Configurazione"],
]);

export function resolvePageTitle(pathname: string): string {
  const staticTitle = STATIC_PAGE_TITLES.get(pathname);
  if (staticTitle) return `${staticTitle} · Sequent`;
  if (pathname.startsWith("/pratiche/")) return "Pratica · Sequent";
  return "Sequent";
}
