<script lang="ts">
  import { LoaderCircle, X } from "@lucide/svelte";

  let { jobs } = $props<{
    jobs: Array<{ id: string; type: string; progress: number }>;
  }>();

  function jobLabel(type: string): string {
    return type === "document.process" ? "Elaborazione documento" : "Analisi Codex";
  }
</script>

<div class="processing-active" aria-label="Elaborazioni in corso" aria-live="polite">
  {#each jobs as job (job.id)}
    <div>
      <LoaderCircle class="spinning" size={18} />
      <span>
        <strong>{jobLabel(job.type)}</strong>
        <small>{job.progress}%</small>
      </span>
      <progress max="100" value={job.progress}><span>{job.progress}%</span></progress>
      <form method="POST" action="?/cancel">
        <input type="hidden" name="jobId" value={job.id} />
        <button class="button text" type="submit"><X size={15} />Annulla</button>
      </form>
    </div>
  {/each}
</div>
