<script lang="ts">
  import { CircleAlert } from "@lucide/svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  let { data } = $props<{ data: PageData }>();
</script>

<div class="workspace-panel-heading"><h2>Situazione</h2><span>{data.declarationReady ? "Pronta" : "Aperta"}</span></div>
<div class="practice-context-panel">
  <div class="context-next-step"><span>Prossimo passo</span><strong>{data.subjects.length === 0 ? "Aggiungi il defunto e i beneficiari" : data.assets.length === 0 ? "Registra i beni e le passività" : data.declarationIssues.length > 0 ? "Risolvi i controlli aperti" : "Controlla il riepilogo della pratica"}</strong></div>
  <dl><div><dt>Soggetti</dt><dd>{data.subjects.length}</dd></div><div><dt>Beni e passività</dt><dd>{data.assets.length}</dd></div><div><dt>Documenti</dt><dd>{data.documents.length}</dd></div><div><dt>Problemi da risolvere</dt><dd>{data.declarationIssues.length}</dd></div></dl>
  {#if data.catalogStatus.status !== "qualified"}<div class="source-caveat"><CircleAlert size={18} /><span>I controlli completi saranno disponibili dopo la verifica di tutti i quadri ministeriali.</span></div>{/if}
  <div class="context-links"><a href="?sezione=checks">Apri i controlli</a><a href="?sezione=final">Apri il riepilogo</a></div>
</div>
