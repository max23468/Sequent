<script lang="ts">
  import { ArrowLeft, CheckCircle2, FileText, FolderOpen, Home, PanelLeftClose, Upload } from "@lucide/svelte";
  let { data, form } = $props();
  const formatDate = (value: string) => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  const formatBytes = (bytes: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB";
</script>

<svelte:head><title>{data.practice.title} · Sequent</title></svelte:head>
<div class="practice-page page-frame">
  <div class="practice-heading">
    <div><p class="breadcrumbs"><a href="/pratiche" data-sveltekit-prefetch data-sveltekit-preload-data="hover">Pratiche</a><span>/</span>{data.practice.title}</p><h1>{data.practice.title}</h1></div>
    <div class="practice-meta"><span>Aggiornata {formatDate(data.practice.updatedAt)}</span><i></i><span class="saved-state"><CheckCircle2 size={18} />Salvato</span><a class="button secondary" href="/" data-sveltekit-prefetch data-sveltekit-preload-data="hover"><ArrowLeft size={18} />Dashboard</a></div>
  </div>
  <div class="practice-workspace">
    <aside class="workspace-sections">
      <div class="workspace-panel-heading"><h2>Sezioni</h2><PanelLeftClose size={19} /></div>
      <nav aria-label="Sezioni pratica"><a href={`/pratiche/${data.practice.id}`}><Home size={19} />Panoramica</a><a class="active" href={`/pratiche/${data.practice.id}`}><FolderOpen size={19} />Documenti</a></nav>
    </aside>
    <section class="workspace-main">
      <div class="workspace-panel-heading"><h2>Documenti</h2><span>{data.documents.length}</span></div>
      <form class="inline-upload" method="POST" action="?/upload" enctype="multipart/form-data">
        <label for="workspace-file">Aggiungi un documento</label>
        <div><input id="workspace-file" name="file" type="file" required /><button class="button primary" type="submit"><Upload size={17} />Carica</button></div>
        {#if form?.uploadError}<p class="form-error" role="alert">{form.uploadError}</p>{/if}
      </form>
      {#if data.documents.length === 0}
        <div class="panel-empty workspace-empty"><FileText size={27} /><p>Nessun documento caricato.</p><span>Gli originali aggiunti alla pratica compariranno qui.</span></div>
      {:else}
        <ul class="document-list">
          {#each data.documents as file (file.id)}
            <li class:selected={data.selectedDocument?.id === file.id}><a href={`?documento=${file.id}`}><FileText size={20} /><span><strong>{file.originalName}</strong><small>{formatBytes(file.byteSize)} · {formatDate(file.createdAt)}</small></span></a></li>
          {/each}
        </ul>
      {/if}
    </section>
    <aside class="workspace-source">
      <div class="workspace-panel-heading"><h2>Fonte</h2></div>
      {#if data.selectedDocument}
        <div class="source-summary"><FileText size={34} /><h3>{data.selectedDocument.originalName}</h3><dl><div><dt>Formato</dt><dd>{data.selectedDocument.mediaType}</dd></div><div><dt>Dimensione</dt><dd>{formatBytes(data.selectedDocument.byteSize)}</dd></div><div><dt>Caricato</dt><dd>{formatDate(data.selectedDocument.createdAt)}</dd></div></dl><p>L’anteprima della fonte verrà introdotta con la pipeline documentale qualificata.</p></div>
      {:else}
        <div class="panel-empty source-empty"><FileText size={27} /><p>Nessuna fonte selezionata.</p><span>Seleziona un documento per consultarne i dati tecnici.</span></div>
      {/if}
    </aside>
  </div>
</div>
