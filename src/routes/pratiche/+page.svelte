<script lang="ts">
  import { ChevronRight, FolderOpen } from "@lucide/svelte";
  let { data } = $props();
</script>

<svelte:head><title>Pratiche · Sequent</title></svelte:head>
<div class="page-frame index-page">
  <div class="page-heading"><div><h1>Pratiche</h1><p>Tutte le pratiche attive, ordinate dall’ultima modifica.</p></div></div>
  <section class="index-panel">
    {#if data.practices.length === 0}
      <div class="panel-empty"><FolderOpen size={26} /><p>Non ci sono pratiche attive.</p></div>
    {:else}
      <ul class="index-list">
        {#each data.practices as practice (practice.id)}
          <li><a href={`/pratiche/${practice.id}`}><span><strong>{practice.title}</strong><small>{practice.documentCount} documenti · revisione {practice.revision}</small></span><ChevronRight size={20} /></a></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
