<script lang="ts">
  import { AlertTriangle, RotateCcw } from "@lucide/svelte";

  let { jobs } = $props<{
    jobs: Array<{
      id: string;
      type: string;
      status: string;
      errorCode: string | null;
      canRetry: boolean;
    }>;
  }>();
</script>

<div class="processing-errors" aria-label="Elaborazioni non riuscite">
  {#each jobs as job (job.id)}
    <div>
      <AlertTriangle size={18} />
      <span>
        <strong>
          {job.status === "cancelled"
            ? "Elaborazione annullata"
            : job.type === "document.process"
              ? "Elaborazione documento non riuscita"
              : "Analisi Codex non riuscita"}
        </strong>
        <small>
          {job.canRetry
            ? "Riprova. Se il problema persiste, consulta la cronologia della pratica."
            : job.type === "codex.analyze_practice"
              ? "I tentativi sono terminati. Avvia una nuova analisi controllata."
              : "I tentativi sono terminati. Consulta la cronologia della pratica."}
        </small>
      </span>
      {#if job.canRetry}
        <form method="POST" action="?/retry">
          <input type="hidden" name="jobId" value={job.id} />
          <button class="button text" type="submit"><RotateCcw size={15} />Riprova</button>
        </form>
      {:else if job.type === "codex.analyze_practice"}
        <form method="POST" action="?/analyze">
          <button class="button text" type="submit"><RotateCcw size={15} />Nuova analisi</button>
        </form>
      {/if}
    </div>
  {/each}
</div>
