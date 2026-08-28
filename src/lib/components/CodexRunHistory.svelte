<script lang="ts">
  import { History } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";

  let { runs, hasThread } = $props<{
    runs: Array<{
      id: string;
      status: string;
      model: string;
      effort: string;
      errorCode: string | null;
      summary: string | null;
      proposalCount: number;
      conflictCount: number;
      createdAt: string;
    }>;
    hasThread: boolean;
  }>();

  function statusLabel(status: string): string {
    if (status === "completed") return "Completata";
    if (status === "failed") return "Non riuscita";
    if (status === "cancelled") return "Annullata";
    if (status === "running") return "In corso";
    return "In attesa";
  }

  function effortLabel(effort: string): string {
    if (effort === "low") return "rapido";
    if (effort === "high" || effort === "xhigh") return "approfondito";
    return "ordinario";
  }
</script>

<div class="codex-history">
  <div class="codex-history-heading">
    <span><History size={18} />Analisi precedenti</span>
    {#if hasThread}
      <form method="POST" action="?/resetCodex">
        <button class="button text" type="submit">Inizia una nuova analisi</button>
      </form>
    {/if}
  </div>
  {#each runs as run (run.id)}
    <details>
      <summary>
        <span>{formatItalianDate(run.createdAt)} · {statusLabel(run.status)}</span>
        <small>{run.proposalCount} proposte · {run.conflictCount} conflitti</small>
      </summary>
      {#if run.summary}<p>{run.summary}</p>{/if}
      {#if run.errorCode}<p class="form-error">L’analisi non è stata completata. Puoi riprovare.</p>{/if}
      <small>Livello di approfondimento: {effortLabel(run.effort)}</small>
    </details>
  {/each}
</div>
