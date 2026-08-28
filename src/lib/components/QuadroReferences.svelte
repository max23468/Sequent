<script lang="ts">
  import { CircleAlert, FileText } from "@lucide/svelte";
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
  <p>{summary?.mappedFieldCount === summary?.technicalFieldCount ? "Etichette, ordine e corrispondenza tecnica di questo Quadro sono stati verificati." : "La struttura tecnica è disponibile; etichette e condizioni non ancora verificate restano segnalate nei controlli della pratica."}</p>
  <dl><div><dt>Campi con etichetta verificata</dt><dd>{summary?.mappedFieldCount ?? 0}</dd></div><div><dt>Campi disponibili</dt><dd>{summary?.technicalFieldCount ?? 0}</dd></div><div><dt>Fonti</dt><dd>Modello ministeriale e controlli dell’Agenzia</dd></div></dl>
  {#if data.selectedQuadro === "Frontespizio"}<div class="source-caveat"><CircleAlert size={18} /><span>Dati generali, beneficiari e dati del defunto sono compilabili; testamento e dati di chi presenta il modello compariranno dopo la verifica delle relative regole.</span></div>{:else if data.selectedQuadro !== "EA"}<div class="source-caveat"><CircleAlert size={18} /><span>Compilazione sospesa fino alla verifica completa delle etichette e delle regole di questo quadro.</span></div>{/if}
</div>
