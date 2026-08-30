import {
  Building2,
  Calculator,
  FileCheck2,
  FileOutput,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  Scale,
  ShieldCheck,
  UsersRound,
} from "@lucide/svelte";

export const practiceSections = [
  { id: "overview", label: "Panoramica", available: true, icon: LayoutDashboard },
  { id: "documents", label: "Documenti", available: true, icon: FolderOpen },
  { id: "verifications", label: "Da verificare", available: true, icon: ListChecks },
  { id: "people", label: "Persone", available: true, icon: UsersRound },
  { id: "estate", label: "Patrimonio", available: true, icon: Building2 },
  { id: "devolution", label: "Devoluzione", available: true, icon: Scale },
  { id: "taxes", label: "Imposte e pagamenti", available: true, icon: Calculator },
  { id: "checks", label: "Controlli finali", available: true, icon: ShieldCheck },
  { id: "official", label: "Invio e ricevute", available: true, icon: FileCheck2 },
  { id: "final", label: "Riepilogo finale", available: true, icon: FileOutput },
] as const;

export const practiceDomainSectionByOperationalSection: Record<string, string> = {
  overview: "declaration",
  documents: "checklist",
  people: "beneficiaries",
  estate: "assets",
  devolution: "devolution",
  taxes: "calculations",
  checks: "checks",
  final: "exports",
  history: "history",
};
