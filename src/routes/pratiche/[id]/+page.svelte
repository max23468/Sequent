<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { tick } from "svelte";
  import {
    ArrowLeft,
    Building2,
    Check,
    CheckCircle2,
    ChevronDown,
    FileText,
    FolderOpen,
    History,
    LayoutDashboard,
    MoreHorizontal,
    Pencil,
    ShieldCheck,
    Upload,
    UserRound,
    UsersRound,
    X,
  } from "@lucide/svelte";
  import { formatItalianDate, formatMegabytes } from "$lib/format";

  let { data, form } = $props();
  let selectedSection = $state("documents");
  let selectedFileName = $state("");

  $effect(() => {
    if (page.url.searchParams.has("documento")) selectedSection = "documents";
  });

  const sections = [
    { id: "overview", label: "Panoramica", stage: "M4", icon: LayoutDashboard },
    { id: "documents", label: "Documenti", stage: "M2", icon: FolderOpen },
    { id: "declaration", label: "Defunto e dichiarazione", stage: "M4", icon: UserRound },
    { id: "beneficiaries", label: "Beneficiari", stage: "M4", icon: UsersRound },
    { id: "properties", label: "Immobili", stage: "M4", icon: Building2 },
    { id: "checks", label: "Controlli", stage: "M4", icon: ShieldCheck },
    { id: "history", label: "Cronologia", stage: "M6", icon: History },
  ] as const;

  async function selectSection(event: MouseEvent) {
    selectedSection = (event.currentTarget as HTMLButtonElement).dataset.section ?? "documents";
    if (selectedSection !== "documents" && page.url.searchParams.has("documento")) {
      await goto(page.url.pathname, {
        replaceState: true,
        noScroll: true,
        keepFocus: true,
        invalidateAll: false,
      });
    }
  }

  async function chooseWorkspaceFile() {
    selectedSection = "documents";
    await tick();
    document.querySelector<HTMLInputElement>("#workspace-file")?.click();
  }

  function handleWorkspaceFile(event: Event) {
    selectedFileName = (event.currentTarget as HTMLInputElement).files?.[0]?.name ?? "";
  }
</script>

<svelte:head><title>{data.practice.title} · Sequent</title></svelte:head>
<div class="practice-page page-frame">
  <div class="practice-heading">
    <div class="practice-heading-copy">
      <p class="breadcrumbs"><a href="/pratiche" data-sveltekit-prefetch data-sveltekit-preload-data="hover">Pratiche</a><span>/</span>{data.practice.title}</p>
      <div class="practice-title-line">
        <h1>{data.practice.title}</h1>
        <span>Aggiornata {formatItalianDate(data.practice.updatedAt)}</span>
        <span class="saved-state"><CheckCircle2 size={18} />Salvato</span>
      </div>
    </div>
    <div class="practice-heading-actions">
      <span class="practice-revision">Revisione {data.practice.revision}</span>
      <details class="workspace-actions-menu">
        <summary class="button secondary">Azioni <ChevronDown size={17} aria-hidden="true" /></summary>
        <div class="workspace-actions-popover">
          <button type="button" onclick={chooseWorkspaceFile}><Upload size={17} />Carica documento</button>
          <button type="button" disabled><FileText size={17} />Esporta riepilogo <small>M4</small></button>
        </div>
      </details>
      <a class="button secondary" href="/" data-sveltekit-prefetch data-sveltekit-preload-data="hover"><ArrowLeft size={18} />Dashboard</a>
    </div>
  </div>

  <div class="practice-workspace">
    <aside class="workspace-sections">
      <div class="workspace-panel-heading"><h2>Sezioni</h2></div>
      <nav aria-label="Sezioni pratica">
        {#each sections as section (section.id)}
          {@const Icon = section.icon}
          <button
            type="button"
            class:active={selectedSection === section.id}
            data-section={section.id}
            aria-pressed={selectedSection === section.id}
            onclick={selectSection}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{section.label}</span>
            {#if section.stage !== "M2"}<small>{section.stage}</small>{/if}
          </button>
        {/each}
      </nav>
    </aside>

    <section class="workspace-main">
      {#if selectedSection === "documents"}
        <div class="workspace-panel-heading"><h2>Documenti</h2><span>{data.documents.length}</span></div>
        <form class="inline-upload" method="POST" action="?/upload" enctype="multipart/form-data">
          <label for="workspace-file">Aggiungi un documento</label>
          <div class="file-picker-row">
            <label class="file-picker" for="workspace-file"><Upload size={17} aria-hidden="true" /><span>{selectedFileName || "Scegli documento"}</span></label>
            <input id="workspace-file" name="file" type="file" required onchange={handleWorkspaceFile} />
            <button class="button primary" type="submit"><Upload size={17} />Carica</button>
          </div>
          {#if form?.uploadError}<p class="form-error" role="alert">{form.uploadError}</p>{/if}
        </form>
        {#if data.failedVerifications.length > 0}
          <div class="technical-alert" role="alert">
            <strong>Verifica tecnica non riuscita</strong>
            <p>Ricarica {data.failedVerifications.length === 1 ? "il documento indicato" : "i documenti indicati"} per ripristinare e verificare gli originali.</p>
            <ul>
              {#each data.failedVerifications as verification (verification.jobId)}
                <li><a href={`?documento=${verification.documentId}`}>{verification.documentName}</a></li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if data.documents.length === 0}
          <div class="panel-empty workspace-empty"><FileText size={27} /><p>Nessun documento caricato.</p><span>Gli originali aggiunti alla pratica compariranno qui.</span></div>
        {:else}
          <ul class="document-list">
            {#each data.documents as file (file.id)}
              <li class:selected={data.selectedDocument?.id === file.id}><a href={`?documento=${file.id}`}><FileText size={20} /><span><strong>{file.originalName}</strong><small>{formatMegabytes(file.byteSize)} · {formatItalianDate(file.createdAt)}</small></span></a></li>
            {/each}
          </ul>
        {/if}
      {:else}
        <div class="workspace-panel-heading"><h2>Da verificare</h2><span>0 di 0</span></div>
        <div class="review-placeholder" aria-label="Struttura futura della revisione">
          <div class="placeholder-kicker"><MoreHorizontal size={18} aria-hidden="true" /><span>Segnaposto {sections.find((section) => section.id === selectedSection)?.stage}</span></div>
          <section class="review-card">
            <div class="review-card-heading"><span>Dato da verificare</span><small>Nessun dato disponibile</small></div>
            <div class="review-values">
              <div><span>Valore attuale</span><strong>—</strong></div>
              <div><span>Valore proposto</span><strong>—</strong></div>
            </div>
            <dl>
              <div><dt>Metodo di verifica</dt><dd>Non disponibile in M2</dd></div>
              <div><dt>Confidenza</dt><dd>Non calcolata</dd></div>
            </dl>
            <div class="review-actions" aria-label="Azioni future non disponibili">
              <button class="button primary" type="button" disabled><Check size={17} />Conferma</button>
              <button class="button secondary" type="button" disabled><Pencil size={17} />Modifica</button>
              <button class="button secondary" type="button" disabled><X size={17} />Rifiuta</button>
            </div>
          </section>
          <div class="future-list-heading">Altri dati da verificare</div>
          <div class="future-empty">Questa sezione sarà collegata soltanto a dati e regole qualificati.</div>
        </div>
      {/if}
    </section>

    <aside class="workspace-source">
      <div class="workspace-panel-heading"><h2>Fonte</h2></div>
      {#if selectedSection === "documents" && data.selectedDocument}
        <div class="source-summary"><FileText size={34} /><h3>{data.selectedDocument.originalName}</h3><dl><div><dt>Formato</dt><dd>{data.selectedDocument.mediaType}</dd></div><div><dt>Dimensione</dt><dd>{formatMegabytes(data.selectedDocument.byteSize)}</dd></div><div><dt>Caricato</dt><dd>{formatItalianDate(data.selectedDocument.createdAt)}</dd></div></dl><p>L’anteprima della fonte verrà introdotta con la pipeline documentale qualificata.</p></div>
      {:else}
        <div class="panel-empty source-empty"><FileText size={27} /><p>Nessuna fonte selezionata.</p><span>{selectedSection === "documents" ? "Seleziona un documento per consultarne i dati tecnici." : "Le fonti compariranno quando questa sezione sarà qualificata."}</span></div>
      {/if}
    </aside>
  </div>
</div>
