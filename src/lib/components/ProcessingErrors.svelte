<script lang="ts">
  import { AlertTriangle, RotateCcw } from "@lucide/svelte";

  let { jobs } = $props<{
    jobs: Array<{ id: string; type: string; status: string; errorCode: string | null }>;
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
        <small>{job.errorCode}</small>
      </span>
      <form method="POST" action="?/retry">
        <input type="hidden" name="jobId" value={job.id} />
        <button class="button text" type="submit"><RotateCcw size={15} />Riprova</button>
      </form>
    </div>
  {/each}
</div>
