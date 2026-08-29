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
  </section>
</div>
