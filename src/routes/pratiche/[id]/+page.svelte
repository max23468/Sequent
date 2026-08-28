<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { tick } from "svelte";
  import {
    ArrowLeft, Bot, Building2, Calculator, Check, CheckCircle2, ChevronDown, CircleAlert,
    FileOutput, FileText, FolderOpen, History, Landmark, LayoutDashboard, ListChecks, LoaderCircle,
    PackageCheck, Pencil, Scale, ShieldCheck, Upload, UserRound, UsersRound, X,
  } from "@lucide/svelte";
  import ProcessingErrors from "$lib/components/ProcessingErrors.svelte";
  import ActiveProcessing from "$lib/components/ActiveProcessing.svelte";
  import CodexRunHistory from "$lib/components/CodexRunHistory.svelte";
  import DocumentSourcePanel from "$lib/components/DocumentSourcePanel.svelte";
  import DocumentList from "$lib/components/DocumentList.svelte";
  import PracticeContextPanel from "$lib/components/PracticeContextPanel.svelte";
  import PracticeDomainSection from "$lib/components/PracticeDomainSection.svelte";
  import PracticeOverview from "$lib/components/PracticeOverview.svelte";
  import QuadroFields from "$lib/components/QuadroFields.svelte";
  import QuadroReferences from "$lib/components/QuadroReferences.svelte";
  import ReviewQueue from "$lib/components/ReviewQueue.svelte";
  import { uploadFilesResumably } from "$lib/client/resumable-upload";
  import { formatItalianDate } from "$lib/format";

  let { data, form } = $props();
  let selectedSection = $derived(page.url.searchParams.get("sezione") ?? "documents");
  let viewMode = $derived<"operational" | "quadri">(
    page.url.searchParams.get("vista") === "quadri" ||
      page.url.searchParams.get("sezione") === "quadri"
      ? "quadri"
      : "operational",
  );
  let selectedFileName = $state("");
  let editedValue = $state("");
  let uploadProgress = $state<number | null>(null);
  let resumableUploadError = $state("");

  const sections = [
    { id: "overview", label: "Panoramica", available: true, icon: LayoutDashboard },
    { id: "documents", label: "Documenti", available: true, icon: FolderOpen },
    { id: "verifications", label: "Da verificare", available: true, icon: ListChecks },
    { id: "declaration", label: "Defunto e dichiarazione", available: true, icon: UserRound },
    { id: "beneficiaries", label: "Soggetti", available: true, icon: UsersRound },
    { id: "assets", label: "Beni e passività", available: true, icon: Building2 },
    { id: "checklist", label: "Documenti richiesti", available: true, icon: PackageCheck },
    { id: "devolution", label: "Devoluzione", available: true, icon: Scale },
    { id: "calculations", label: "Calcoli", available: true, icon: Calculator },
    { id: "checks", label: "Controlli", available: true, icon: ShieldCheck },
    { id: "exports", label: "Riepilogo ed esportazione", available: true, icon: FileOutput },
    { id: "history", label: "Cronologia", available: true, icon: History },
  ] as const;
  const statusLabels: Record<string, string> = {
    received: "Ricevuto", classifying: "Classificazione…", processing: "Elaborazione…",
    processed: "Elaborato", to_review: "Da verificare", unsupported: "Non elaborabile",
    unreadable: "Illeggibile", authoritative: "Fonte autorevole",
    candidate_attachment: "Da preparare per l’invio",
    included_attachment: "Allegato controllato",
  };
  const domainSections = new Set([
    "declaration", "beneficiaries", "assets", "checklist", "devolution",
    "calculations", "checks", "exports", "history",
  ]);

  let selectedSourceRef = $derived(
    data.selectedReview?.sourceRefs.find(
      (source: { documentId: string }) => source.documentId === data.selectedDocument?.id,
    ),
  );
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
    const section = (event.currentTarget as HTMLButtonElement).dataset.section ?? "documents";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", section);
    if (section !== "documents") search.delete("documento");
    if (section !== "verifications") search.delete("verifica");
    await goto(`${page.url.pathname}?${search}`, { replaceState: true, noScroll: true, keepFocus: true, invalidateAll: false });
  }
  async function selectView(mode: "operational" | "quadri") {
    const nextSection = mode === "quadri" ? "quadri" : "overview";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("vista", mode);
    search.set("sezione", nextSection);
    if (mode === "quadri" && !search.has("quadro")) search.set("quadro", "EA");
    await goto(`${page.url.pathname}?${search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }
  function selectOperationalView() {
    return selectView("operational");
  }
  function selectQuadriView() {
    return selectView("quadri");
  }
  async function selectQuadro(event: MouseEvent) {
    const quadro = (event.currentTarget as HTMLButtonElement).dataset.quadro ?? "EA";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("vista", "quadri");
    search.set("sezione", "quadri");
    search.set("quadro", quadro);
    await goto(`${page.url.pathname}?${search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }
  async function chooseWorkspaceFile() {
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", "documents");
    search.set("vista", "operational");
    search.delete("documento");
    await goto(`${page.url.pathname}?${search}`, { replaceState: true, noScroll: true });
    await tick();
    document.querySelector<HTMLInputElement>("#workspace-file")?.click();
  }
  function handleWorkspaceFile(event: Event) {
    selectedFileName = (event.currentTarget as HTMLInputElement).files?.[0]?.name ?? "";
  }
  function handleEditedValue(event: Event) {
    editedValue = (event.currentTarget as HTMLInputElement).value;
  }
  function formAction(name: string, section = selectedSection): string {
    const search = new URLSearchParams(page.url.searchParams);
    const actionKeys = Array.from(search.keys()).filter((key) => key.startsWith("/"));
    for (const key of actionKeys) search.delete(key);
    search.set("sezione", section);
    search.set("vista", section === "quadri" ? "quadri" : "operational");
    if (section === "quadri" && !search.has("quadro")) search.set("quadro", data.selectedQuadro);
    return `?/${name}&${search.toString()}`;
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
      <div class="practice-view-switch" aria-label="Organizzazione della pratica">
        <button type="button" class:active={viewMode === "operational"} aria-pressed={viewMode === "operational"} onclick={selectOperationalView}>Vista operativa</button>
        <button type="button" class:active={viewMode === "quadri"} aria-pressed={viewMode === "quadri"} onclick={selectQuadriView}>Vista Quadri</button>
      </div>
      <span class="practice-revision">Revisione {data.declaration.revision}</span>
      <details class="workspace-actions-menu">
        <summary class="button secondary">Azioni <ChevronDown size={17} /></summary>
        <div class="workspace-actions-popover"><button type="button" onclick={chooseWorkspaceFile}><Upload size={17} />Carica documento</button><a href={`/pratiche/${data.practice.id}/riepilogo`} target="_blank"><FileText size={17} />Apri il riepilogo</a></div>
      </details>
      <a class="button secondary" href="/" data-sveltekit-prefetch><ArrowLeft size={18} />Dashboard</a>
    </div>
  </div>

  <div class="practice-workspace">
    <aside class="workspace-sections">
      <div class="workspace-panel-heading"><h2>{viewMode === "quadri" ? "Quadri" : "Sezioni"}</h2></div>
      {#if viewMode === "operational"}
        <nav aria-label="Sezioni pratica">
          {#each sections as section (section.id)}
            {@const Icon = section.icon}
            <button type="button" class:active={selectedSection === section.id} data-section={section.id} aria-pressed={selectedSection === section.id} onclick={selectSection}>
              <Icon size={19} /><span>{section.label}</span>
              {#if section.id === "verifications" && data.reviewItems.length > 0}<small>{data.reviewItems.length}</small>{/if}
            </button>
          {/each}
        </nav>
      {:else}
        <nav aria-label="Quadri della dichiarazione" class="quadri-navigation">
          {#each data.quadri as quadro (quadro.id)}
            <button type="button" class:active={data.selectedQuadro === quadro.id} data-quadro={quadro.id} aria-pressed={data.selectedQuadro === quadro.id} aria-label={`${quadro.id === "Frontespizio" ? "Frontespizio" : `Quadro ${quadro.id}`}: ${quadro.verifiedFieldCount} etichette verificate su ${quadro.userFieldCount} campi compilabili`} title={`${quadro.verifiedFieldCount} etichette verificate su ${quadro.userFieldCount} campi compilabili`} onclick={selectQuadro}>
              <FileText size={18} /><span>{quadro.id === "Frontespizio" ? "Frontespizio" : `Quadro ${quadro.id}`}</span><small>{quadro.verifiedFieldCount}/{quadro.userFieldCount}</small>
            </button>
          {/each}
        </nav>
      {/if}
    </aside>

    <section class="workspace-main">
      {#if data.activeJobs.length > 0}
        <ActiveProcessing jobs={data.activeJobs} />
      {/if}
      {#if form?.retryError}<p class="workspace-form-error" role="alert">{form.retryError}</p>{/if}
      {#if form?.cancelError}<p class="workspace-form-error" role="alert">{form.cancelError}</p>{/if}
      {#if viewMode === "quadri"}
        <QuadroFields {data} {form} actionUrl={formAction("saveFields", "quadri")} duplicateActionUrl={formAction("duplicateSubjectEntry", "quadri")} />
      {:else if selectedSection === "overview"}
        <PracticeOverview {data} />
      {:else if selectedSection === "documents"}
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
          <DocumentList documents={data.documents} selectedDocumentId={data.selectedDocument?.id ?? null} {statusLabels} />
        {/if}
      {:else if selectedSection === "verifications"}
        <div class="workspace-panel-heading"><h2>Da verificare</h2><span>{data.reviewItems.length}</span></div>
        <div class="analysis-toolbar">
          <div><Bot size={20} /><span><strong>Analisi assistita</strong><small>Codex propone; la decisione resta tua.</small></span></div>
          <form method="POST" action={formAction("analyze", "verifications")}><button class="button secondary" type="submit" disabled={data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}>
            {#if data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}<LoaderCircle class="spinning" size={17} />Analisi in corso{:else}<Bot size={17} />{data.codexRuns.length > 0 ? "Rianalizza con Codex" : "Analizza con Codex"}{/if}
          </button></form>
        </div>
        {#if data.codexRuns.length > 0}
          <CodexRunHistory runs={data.codexRuns} hasThread={data.hasCodexThread} />
        {/if}
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
                {#if selectedSourceRef?.excerpt ?? data.selectedReview.sourceExcerpt}<div><dt>Estratto</dt><dd class="source-excerpt">{selectedSourceRef?.excerpt ?? data.selectedReview.sourceExcerpt}</dd></div>{/if}
              </dl>
              <form class="review-decision-form" method="POST" action={formAction("review", "verifications")}>
                <input type="hidden" name="itemId" value={data.selectedReview.id} /><label for="review-edit">Correggi prima di confermare</label><input id="review-edit" name="value" value={editedValue} oninput={handleEditedValue} placeholder={displayValue(data.selectedReview.proposedValue)} maxlength="2000" />
                <div class="review-actions"><button class="button primary" type="submit" name="decision" value="confirmed" disabled={data.selectedReview.proposedValue === null}><Check size={17} />Conferma</button><button class="button secondary" type="submit" name="decision" value="edited" disabled={!editedValue.trim()}><Pencil size={17} />Conferma correzione</button><button class="button secondary" type="submit" name="decision" value="rejected"><X size={17} />Rifiuta</button><button class="button text" type="submit" name="decision" value="ignored">Ignora</button></div>
              </form>
            </section>
            <ReviewQueue items={data.reviewItems} selectedId={data.selectedReview.id} />
          </div>
        {/if}
      {:else if domainSections.has(selectedSection)}
        <PracticeDomainSection
          {data}
          {form}
          {selectedSection}
          createDeclarationAction={formAction("createDeclaration", "declaration")}
          addSubjectAction={formAction("addSubject", "beneficiaries")}
          addAssetAction={formAction("addAsset", "assets")}
          checklistAction={formAction("updateChecklist", "checklist")}
          saveDevolutionAction={formAction("saveDevolution", "devolution")}
          confirmDevolutionAction={formAction("confirmDevolution", "devolution")}
          runCalculationAction={formAction("runCalculation", "calculations")}
          confirmCalculationAction={formAction("confirmCalculation", "calculations")}
        />
      {:else}
        <div class="panel-empty workspace-empty"><LayoutDashboard size={27} /><p>Sezione non disponibile.</p><span>Torna alla panoramica della pratica.</span></div>
      {/if}
      {#if form?.domainError}<p class="workspace-form-error" role="alert">{form.domainError}</p>{/if}
    </section>

    <aside class="workspace-source">
      {#if viewMode === "quadri"}
        <QuadroReferences {data} />
      {:else if selectedSection !== "documents" && selectedSection !== "verifications"}
        <PracticeContextPanel {data} />
      {:else}
        <DocumentSourcePanel {data} {form} {statusLabels} {selectedSourceRef} />
      {/if}
    </aside>
  </div>
</div>
