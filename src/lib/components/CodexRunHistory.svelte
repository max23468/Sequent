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
</script>

<div class="codex-history">
  <div class="codex-history-heading">
    <span><History size={18} />Analisi precedenti</span>
    {#if hasThread}
      <form method="POST" action="?/resetCodex">
        <button class="button text" type="submit">Reimposta contesto</button>
      </form>
    {/if}
  </div>
  {#each runs as run (run.id)}
    <details>
      <summary>
        <span>{formatItalianDate(run.createdAt)} · {run.status}</span>
        <small>{run.proposalCount} proposte · {run.conflictCount} conflitti</small>
      </summary>
      {#if run.summary}<p>{run.summary}</p>{/if}
      {#if run.errorCode}<p class="form-error">{run.errorCode}</p>{/if}
      <small>Livello di approfondimento: {run.effort}</small>
    </details>
  {/each}
</div>
