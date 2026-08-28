<script lang="ts">
  import { FileText } from "@lucide/svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  let { data } = $props<{ data: PageData }>();
  const summary = $derived(
    data.quadri.find((quadro: { id: string }) => quadro.id === data.selectedQuadro),
  );
  function hasRepeatedPositions(subjectId: string): boolean {
    let count = 0;
    for (const entry of data.quadroSubjects) {
      if (entry.subjectId === subjectId) count += 1;
    }
    return count > 1;
  }
</script>

<div class="workspace-panel-heading"><h2>Riferimenti</h2><span>Modello 2025</span></div>
<div class="official-source-panel">
  <FileText size={28} />
  <h3>{data.selectedQuadro === "Frontespizio" ? "Frontespizio" : `Quadro ${data.selectedQuadro}`}</h3>
  {#if data.selectedQuadro === "EA" && data.selectedSubject}<strong class="source-subject">{data.selectedSubject.displayName}{hasRepeatedPositions(data.selectedSubject.subjectId) ? ` · posizione ${data.selectedSubject.occurrence}` : ""}</strong>{/if}
  <p>Etichette, ordine e corrispondenza con il modello di questo Quadro sono stati verificati.</p>
  <dl><div><dt>Campi con etichetta verificata</dt><dd>{summary?.verifiedFieldCount ?? 0}</dd></div><div><dt>Campi compilabili</dt><dd>{summary?.userFieldCount ?? 0}</dd></div><div><dt>Fonti</dt><dd>Modello ministeriale e controlli dell’Agenzia</dd></div></dl>
</div>
