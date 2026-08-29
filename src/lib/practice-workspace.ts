import {
  Building2,
  Calculator,
  FileOutput,
  FolderOpen,
  History,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  Scale,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "@lucide/svelte";

export const practiceSections = [
  { id: "overview", label: "Panoramica", available: true, icon: LayoutDashboard },
  { id: "documents", label: "Documenti", available: true, icon: FolderOpen },
  { id: "verifications", label: "Da verificare", available: true, icon: ListChecks },
  { id: "declaration", label: "Defunto e dichiarazione", available: true, icon: UserRound },
  { id: "beneficiaries", label: "Soggetti", available: true, icon: UsersRound },
  { id: "assets", label: "Beni e passività", available: true, icon: Building2 },
  { id: "checklist", label: "Documenti richiesti", available: true, icon: PackageCheck },
  { id: "devolution", label: "Devoluzione", available: true, icon: Scale },
  { id: "calculations", label: "Calcoli", available: true, icon: Calculator },
  { id: "checks", label: "Controlli", available: true, icon: ShieldCheck },
  { id: "exports", label: "Riepilogo ed esportazione", available: true, icon: FileOutput },
  { id: "history", label: "Cronologia", available: true, icon: History },
] as const;

export const practiceDomainSections = new Set([
  "declaration",
  "beneficiaries",
  "assets",
  "checklist",
  "devolution",
  "calculations",
  "checks",
  "exports",
  "history",
]);
