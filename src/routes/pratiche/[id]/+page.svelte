<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { tick } from "svelte";
  import {
    ArrowLeft, Bot, Building2, Check, CheckCircle2, ChevronDown, Eye,
    FileText, FolderOpen, History, LayoutDashboard, ListChecks, LoaderCircle,
    MoreHorizontal, Pencil, ShieldCheck, Upload, UserRound, UsersRound, X,
  } from "@lucide/svelte";
  import ProcessingErrors from "$lib/components/ProcessingErrors.svelte";
  import SourceTabs from "$lib/components/SourceTabs.svelte";
  import { uploadFilesResumably } from "$lib/client/resumable-upload";
  import { formatItalianDate, formatMegabytes } from "$lib/format";

  let { data, form } = $props();
  let selectedSection = $state(page.url.searchParams.get("sezione") ?? "documents");
  let selectedFileName = $state("");
  let editedValue = $state("");
  let uploadProgress = $state<number | null>(null);
  let resumableUploadError = $state("");

  const sections = [
    { id: "overview", label: "Panoramica", stage: "M4", icon: LayoutDashboard },
    { id: "documents", label: "Documenti", stage: "M3", icon: FolderOpen },
    { id: "verifications", label: "Da verificare", stage: "M3", icon: ListChecks },
    { id: "declaration", label: "Defunto e dichiarazione", stage: "M4", icon: UserRound },
    { id: "beneficiaries", label: "Beneficiari", stage: "M4", icon: UsersRound },
    { id: "properties", label: "Immobili", stage: "M4", icon: Building2 },
    { id: "checks", label: "Controlli", stage: "M4", icon: ShieldCheck },
    { id: "history", label: "Cronologia", stage: "M6", icon: History },
  ] as const;
  const statusLabels: Record<string, string> = {
    received: "Ricevuto", classifying: "Classificazione…", processing: "Elaborazione…",
    processed: "Elaborato", to_review: "Da verificare", unsupported: "Non elaborabile",
    unreadable: "Illeggibile", authoritative: "Fonte autorevole",
  };

  let selectedReviewPage = $derived(data.selectedReview?.pageNumber ?? null);
  let selectedSourcePage = $derived(
    selectedReviewPage
      ? data.selectedDocumentPages.find((candidate: { pageNumber: number }) => candidate.pageNumber === selectedReviewPage)
      : data.selectedDocumentPages.at(0),
  );

  $effect(() => {
    const requested = page.url.searchParams.get("sezione");
    if (requested) selectedSection = requested;
    else if (page.url.searchParams.has("documento")) selectedSection = "documents";
  });
  $effect(() => {
    if (data.activeJobs.length === 0) return;
    const timer = window.setInterval(() => void invalidateAll(), 1_500);
    return () => window.clearInterval(timer);
  });

  function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "Non indicato";
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  async function selectSection(event: MouseEvent) {
    selectedSection = (event.currentTarget as HTMLButtonElement).dataset.section ?? "documents";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", selectedSection);
    if (selectedSection !== "documents") search.delete("documento");
    if (selectedSection !== "verifications") search.delete("verifica");
    await goto(`${page.url.pathname}?${search}`, { replaceState: true, noScroll: true, keepFocus: true, invalidateAll: false });
  }
  async function chooseWorkspaceFile() {
    selectedSection = "documents";
    await tick();
    document.querySelector<HTMLInputElement>("#workspace-file")?.click();
  }
  function handleWorkspaceFile(event: Event) {
    selectedFileName = (event.currentTarget as HTMLInputElement).files?.[0]?.name ?? "";
  }
  function handleEditedValue(event: Event) {
    editedValue = (event.currentTarget as HTMLInputElement).value;
  }
  async function uploadDocument(event: SubmitEvent) {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#workspace-file");
    const file = input?.files?.[0];
    if (!file) {
      resumableUploadError = "Scegli un documento da caricare.";
      return;
    }
    resumableUploadError = "";
    uploadProgress = 0;
    try {
      const result = await uploadFilesResumably(
        [file],
        { practiceId: data.practice.id },
        (progress) => (uploadProgress = progress),
      );
      window.location.assign(result.location);
    } catch (error) {
      resumableUploadError =
        error instanceof Error && !error.message.startsWith("{")
          ? error.message
          : "Caricamento interrotto. Seleziona di nuovo lo stesso file per riprenderlo.";
      uploadProgress = null;
    }
  }
</script>

<svelte:head><title>{data.practice.title} · Sequent</title></svelte:head>
<div class="practice-page page-frame">
  <div class="practice-heading">
    <div class="practice-heading-copy">
      <p class="breadcrumbs"><a href="/pratiche" data-sveltekit-prefetch>Pratiche</a><span>/</span>{data.practice.title}</p>
      <div class="practice-title-line"><h1>{data.practice.title}</h1><span>Aggiornata {formatItalianDate(data.practice.updatedAt)}</span><span class="saved-state"><CheckCircle2 size={18} />Salvato</span></div>
    </div>
    <div class="practice-heading-actions">
      <span class="practice-revision">Revisione {data.practice.revision}</span>
      <details class="workspace-actions-menu">
        <summary class="button secondary">Azioni <ChevronDown size={17} /></summary>
        <div class="workspace-actions-popover"><button type="button" onclick={chooseWorkspaceFile}><Upload size={17} />Carica documento</button><button type="button" disabled><FileText size={17} />Esporta riepilogo <small>M4</small></button></div>
      </details>
      <a class="button secondary" href="/" data-sveltekit-prefetch><ArrowLeft size={18} />Dashboard</a>
    </div>
  </div>

  <div class="practice-workspace">
    <aside class="workspace-sections">
      <div class="workspace-panel-heading"><h2>Sezioni</h2></div>
      <nav aria-label="Sezioni pratica">
        {#each sections as section (section.id)}
          {@const Icon = section.icon}
          <button type="button" class:active={selectedSection === section.id} data-section={section.id} aria-pressed={selectedSection === section.id} onclick={selectSection}>
            <Icon size={19} /><span>{section.label}</span>
            {#if section.id === "verifications" && data.reviewItems.length > 0}<small>{data.reviewItems.length}</small>{:else if section.stage !== "M3"}<small>{section.stage}</small>{/if}
          </button>
        {/each}
      </nav>
    </aside>

    <section class="workspace-main">
      {#if selectedSection === "documents"}
        <div class="workspace-panel-heading"><h2>Documenti</h2><span>{data.documents.length}</span></div>
        <form class="inline-upload" method="POST" action="?/upload" enctype="multipart/form-data" onsubmit={uploadDocument}>
          <label for="workspace-file">Aggiungi un documento</label>
          <div class="file-picker-row"><label class="file-picker" for="workspace-file"><Upload size={17} /><span>{selectedFileName || "Scegli documento"}</span></label><input id="workspace-file" name="file" type="file" required onchange={handleWorkspaceFile} /><button class="button primary" type="submit" disabled={uploadProgress !== null}>{#if uploadProgress !== null}<LoaderCircle class="spinning" size={17} />{uploadProgress}%{:else}<Upload size={17} />Carica{/if}</button></div>
          {#if uploadProgress !== null}<progress class="upload-progress" max="100" value={uploadProgress}><span>{uploadProgress}%</span></progress>{/if}
          {#if resumableUploadError}<p class="form-error" role="alert">{resumableUploadError}</p>{/if}
          {#if form?.uploadError}<p class="form-error" role="alert">{form.uploadError}</p>{/if}
        </form>
        {#if data.failedVerifications.length > 0}
          <div class="technical-alert" role="alert"><strong>Verifica tecnica non riuscita</strong><p>Ricarica {data.failedVerifications.length === 1 ? "il documento indicato" : "i documenti indicati"} per ripristinare e verificare gli originali.</p><ul>{#each data.failedVerifications as verification (verification.jobId)}<li><a href={`?sezione=documents&documento=${verification.documentId}`}>{verification.documentName}</a></li>{/each}</ul></div>
        {/if}
        {#if data.failedJobs.length > 0}
          <ProcessingErrors jobs={data.failedJobs} />
        {/if}
        {#if data.documents.length === 0}
          <div class="panel-empty workspace-empty"><FileText size={27} /><p>Nessun documento caricato.</p><span>Gli originali aggiunti alla pratica compariranno qui.</span></div>
        {:else}
          <ul class="document-list">
            {#each data.documents as file (file.id)}
              <li class:selected={data.selectedDocument?.id === file.id}><a href={`?sezione=documents&documento=${file.id}`}>
                {#if ["processing", "classifying", "received"].includes(file.status)}<LoaderCircle class="spinning" size={20} />{:else}<FileText size={20} />{/if}
                <span><strong>{file.originalName}</strong><small>{formatMegabytes(file.byteSize)} · {statusLabels[file.status] ?? file.status}{file.pageCount ? ` · ${file.pageCount} pag.` : ""}</small></span>
              </a></li>
            {/each}
          </ul>
        {/if}
      {:else if selectedSection === "verifications"}
        <div class="workspace-panel-heading"><h2>Da verificare</h2><span>{data.reviewItems.length}</span></div>
        <div class="analysis-toolbar">
          <div><Bot size={20} /><span><strong>Analisi assistita</strong><small>Codex propone; la decisione resta tua.</small></span></div>
          <form method="POST" action="?/analyze"><button class="button secondary" type="submit" disabled={data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}>
            {#if data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}<LoaderCircle class="spinning" size={17} />Analisi in corso{:else}<Bot size={17} />{data.codexRuns.length > 0 ? "Rianalizza con Codex" : "Analizza con Codex"}{/if}
          </button></form>
        </div>
        {#if form?.analyzeError}<p class="workspace-form-error" role="alert">{form.analyzeError}</p>{/if}
        {#if form?.reviewError}<p class="workspace-form-error" role="alert">{form.reviewError}</p>{/if}
        {#if data.reviewItems.length === 0}
          <div class="panel-empty workspace-empty"><ListChecks size={27} /><p>Nessuna verifica in sospeso.</p><span>Le letture incerte e le proposte Codex compariranno qui, sempre con la fonte.</span></div>
        {:else if data.selectedReview}
          <div class="review-workspace">
            <section class="review-card current-review">
              <div class="review-card-heading"><span>{data.selectedReview.label}</span><small>{data.selectedReview.documentName ?? "Fonte non disponibile"}</small></div>
              <div class="review-values single-proposal"><div><span>Valore proposto</span><strong>{displayValue(data.selectedReview.proposedValue)}</strong></div></div>
              {#if data.selectedReview.alternatives.length > 0}<div class="review-alternatives"><span>Alternative</span><ul>{#each data.selectedReview.alternatives as alternative}<li>{displayValue(alternative)}</li>{/each}</ul></div>{/if}
              <dl>
                <div><dt>Metodo</dt><dd>{data.selectedReview.method === "codex" ? "Codex" : data.selectedReview.method === "ocr" ? "OCR" : data.selectedReview.method}</dd></div>
                <div><dt>Affidabilità</dt><dd>{data.selectedReview.confidence === null ? "Non dichiarata" : `${Math.round(data.selectedReview.confidence * 100)}%`}</dd></div>
                <div><dt>Fonte</dt><dd>{data.selectedReview.documentName ?? "—"}{data.selectedReview.pageNumber ? `, pagina ${data.selectedReview.pageNumber}` : ""}</dd></div>
                {#if data.selectedReview.sourceExcerpt}<div><dt>Estratto</dt><dd class="source-excerpt">{data.selectedReview.sourceExcerpt}</dd></div>{/if}
              </dl>
              <form class="review-decision-form" method="POST" action="?/review">
                <input type="hidden" name="itemId" value={data.selectedReview.id} /><label for="review-edit">Correggi prima di confermare</label><input id="review-edit" name="value" value={editedValue} oninput={handleEditedValue} placeholder={displayValue(data.selectedReview.proposedValue)} maxlength="2000" />
                <div class="review-actions"><button class="button primary" type="submit" name="decision" value="confirmed"><Check size={17} />Conferma</button><button class="button secondary" type="submit" name="decision" value="edited" disabled={!editedValue.trim()}><Pencil size={17} />Conferma correzione</button><button class="button secondary" type="submit" name="decision" value="rejected"><X size={17} />Rifiuta</button><button class="button text" type="submit" name="decision" value="ignored">Ignora</button></div>
              </form>
            </section>
            {#if data.reviewItems.length > 1}
              <div class="review-queue-heading">Altre verifiche</div><ul class="review-queue">{#each data.reviewItems.filter((item: { id: string }) => item.id !== data.selectedReview?.id) as item (item.id)}<li><a href={`?sezione=verifications&verifica=${item.id}`}><span><strong>{item.label}</strong><small>{item.documentName ?? "Senza documento"}{item.pageNumber ? ` · pag. ${item.pageNumber}` : ""}</small></span><Eye size={17} /></a></li>{/each}</ul>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="workspace-panel-heading"><h2>{sections.find((section) => section.id === selectedSection)?.label ?? "Sezione"}</h2><span>{sections.find((section) => section.id === selectedSection)?.stage}</span></div>
        <div class="review-placeholder"><div class="placeholder-kicker"><MoreHorizontal size={18} /><span>Perimetro {sections.find((section) => section.id === selectedSection)?.stage}</span></div><section class="review-card"><div class="review-card-heading"><span>Dominio non ancora qualificato</span><small>Nessun dato disponibile</small></div><div class="review-values"><div><span>Valore attuale</span><strong>—</strong></div><div><span>Valore proposto</span><strong>—</strong></div></div><dl><div><dt>Metodo di verifica</dt><dd>Non disponibile prima di M4</dd></div><div><dt>Confidenza</dt><dd>Non calcolata</dd></div></dl><div class="review-actions"><button class="button primary" type="button" disabled><Check size={17} />Conferma</button><button class="button secondary" type="button" disabled><Pencil size={17} />Modifica</button><button class="button secondary" type="button" disabled><X size={17} />Rifiuta</button></div></section><div class="future-list-heading">Contenuto futuro</div><div class="future-empty">Questa sezione sarà collegata soltanto a dati e regole ufficiali qualificati in M4.</div></div>
      {/if}
    </section>

    <aside class="workspace-source">
      <div class="workspace-panel-heading"><h2>Fonte</h2>{#if data.selectedReview?.pageNumber}<span>Pag. {data.selectedReview.pageNumber}</span>{/if}</div>
      {#if data.selectedReview && data.selectedReview.sourceRefs.length > 1}
        <SourceTabs sourceRefs={data.selectedReview.sourceRefs} documents={data.documents} selectedDocumentId={data.selectedDocument?.id ?? null} reviewId={data.selectedReview.id} />
      {/if}
      {#if data.selectedDocument}
        <div class="source-viewer">
          {#if data.selectedDocument.mediaType.startsWith("image/")}<img src={`/api/documents/${data.selectedDocument.id}/content`} alt={`Originale ${data.selectedDocument.originalName}`} />
          {:else if data.selectedDocument.mediaType === "application/pdf"}<iframe src={`/api/documents/${data.selectedDocument.id}/content`} title={`Originale ${data.selectedDocument.originalName}`}></iframe>
          {:else if selectedSourcePage}<pre>{selectedSourcePage.text || "Nessun testo estraibile."}</pre>
          {:else}<div class="panel-empty source-preview-empty"><FileText size={27} /><p>Anteprima non disponibile.</p><span>L’originale è conservato e può essere aperto separatamente.</span></div>{/if}
        </div>
        <div class="source-metadata"><h3>{data.selectedDocument.originalName}</h3><dl><div><dt>Formato</dt><dd>{data.selectedDocument.detectedFormat ?? data.selectedDocument.mediaType}</dd></div><div><dt>Stato</dt><dd>{statusLabels[data.selectedDocument.status] ?? data.selectedDocument.status}</dd></div><div><dt>Dimensione</dt><dd>{formatMegabytes(data.selectedDocument.byteSize)}</dd></div><div><dt>Caricato</dt><dd>{formatItalianDate(data.selectedDocument.createdAt)}</dd></div></dl><a class="button text source-open" href={`/api/documents/${data.selectedDocument.id}/content`} target="_blank" rel="noreferrer"><Eye size={16} />Apri originale</a></div>
      {:else}<div class="panel-empty source-empty"><FileText size={27} /><p>Nessuna fonte selezionata.</p><span>Seleziona un documento o una verifica per consultarne la fonte.</span></div>{/if}
    </aside>
  </div>
</div>
