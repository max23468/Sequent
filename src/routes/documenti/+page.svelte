<script lang="ts">
  import { ChevronRight, FileText } from "@lucide/svelte";
  let { data } = $props();
  const formatBytes = (bytes: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB";
</script>

<svelte:head><title>Documenti · Sequent</title></svelte:head>
<div class="page-frame index-page">
  <div class="page-heading"><div><h1>Documenti</h1><p>I file originali già caricati nelle pratiche attive.</p></div></div>
  <section class="index-panel">
    {#if data.documents.length === 0}
      <div class="panel-empty"><FileText size={26} /><p>Non ci sono documenti caricati.</p></div>
    {:else}
      <ul class="index-list">
        {#each data.documents as file (file.id)}
          <li><a href={`/pratiche/${file.practiceId}?documento=${file.id}`}><FileText size={20} /><span><strong>{file.originalName}</strong><small>{file.practiceTitle} · {formatBytes(file.byteSize)}</small></span><ChevronRight size={20} /></a></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
