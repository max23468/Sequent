<script lang="ts">
  import { CheckCircle2, CircleAlert } from "@lucide/svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  let { data } = $props<{ data: PageData }>();
</script>

<div class="workspace-panel-heading"><h2>Panoramica</h2><span>{data.declarationReady ? "Pronta" : "Da completare"}</span></div>
<div class="domain-overview">
  <section class="domain-summary">
    <div><span>Dichiarazioni</span><strong>{data.declarations.length}</strong></div>
    <div><span>Soggetti</span><strong>{data.subjects.length}</strong></div>
    <div><span>Beni e passività</span><strong>{data.assets.length}</strong></div>
    <div><span>Controlli da risolvere</span><strong>{data.declarationIssues.filter((issue: { level: string }) => issue.level === "blocking").length}</strong></div>
  </section>
  <section class:blocked={data.catalogStatus.status !== "qualified"} class="readiness-panel">
    <div>{#if data.catalogStatus.status === "qualified"}<CheckCircle2 size={22} />{:else}<CircleAlert size={22} />{/if}<div><strong>{data.catalogStatus.status === "qualified" ? "Fonti ministeriali pronte" : "Fonti ministeriali da completare"}</strong><p>{data.catalogStatus.status === "qualified" ? "Tutti i Quadri e i controlli collegati alle fonti sono disponibili." : "Alcune corrispondenze con le fonti ministeriali devono ancora essere risolte."}</p></div></div>
    <dl><div><dt>Campi compilabili verificati</dt><dd>{data.catalogStatus.visibleFieldsMapped}</dd></div><div><dt>Dati gestiti automaticamente</dt><dd>{data.catalogStatus.systemManagedFields}</dd></div><div><dt>Voci ministeriali individuate</dt><dd>{data.catalogStatus.technicalPaths}</dd></div></dl>
  </section>
  <section class="next-step-panel"><span>Prossimo passo</span><strong>{data.subjects.length === 0 ? "Aggiungi il defunto e i beneficiari" : data.assets.length === 0 ? "Registra i beni e le passività" : data.declarationIssues.length > 0 ? "Risolvi i controlli aperti" : "Controlla il riepilogo della pratica"}</strong></section>
</div>
