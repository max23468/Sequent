<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import {
    Bot, Check, FileText, LayoutDashboard, ListChecks, LoaderCircle, Pencil, Upload, X,
  } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import ProcessingErrors from "$lib/components/ProcessingErrors.svelte";
  import ActiveProcessing from "$lib/components/ActiveProcessing.svelte";
  import CodexRunHistory from "$lib/components/CodexRunHistory.svelte";
  import DocumentSourcePanel from "$lib/components/DocumentSourcePanel.svelte";
  import DocumentList from "$lib/components/DocumentList.svelte";
  import PracticeContextPanel from "$lib/components/PracticeContextPanel.svelte";
  import PracticeDomainSection from "$lib/components/PracticeDomainSection.svelte";
  import PracticeOverview from "$lib/components/PracticeOverview.svelte";
  import PracticeWorkspaceHeader from "$lib/components/PracticeWorkspaceHeader.svelte";
  import PracticeWorkspaceNavigation from "$lib/components/PracticeWorkspaceNavigation.svelte";
  import OperationalAreaFields from "$lib/components/OperationalAreaFields.svelte";
  import OfflinePracticeControls from "$lib/components/OfflinePracticeControls.svelte";
  import OfficialFlow from "$lib/components/OfficialFlow.svelte";
  import QuadroFields from "$lib/components/QuadroFields.svelte";
  import QuadroReferences from "$lib/components/QuadroReferences.svelte";
  import ReviewQueue from "$lib/components/ReviewQueue.svelte";
  import { formatDisplayValue } from "$lib/format";
  import { uploadFilesResumably } from "$lib/client/resumable-upload";
  import { documentStatusLabels } from "$lib/document-status";
  import { practiceDomainSectionByOperationalSection } from "$lib/practice-workspace";
  import { getOfflinePractice } from "$lib/offline/store";
  import { isServerReachable, queueAttachment } from "$lib/offline/manager";
  import { interceptOfflinePracticeForm } from "$lib/offline/forms";
  import "../../../styles/practice.css";

  let { data, form } = $props();
  let selectedSection = $derived(page.url.searchParams.get("sezione") ?? "overview");
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
  let offlineQueueMessage = $state("");
  let selectedDomainSection = $derived.by(() => {
    const section = selectedSection;
    return practiceDomainSectionByOperationalSection[section] ?? null;
  });

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

  async function selectSection(event: MouseEvent) {
    const section = (event.currentTarget as HTMLButtonElement).dataset.section ?? "documents";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", section);
    if (section !== "documents") search.delete("documento");
    if (section !== "verifications") search.delete("verifica");
    await navigatePractice(`${page.url.pathname}?${search}`, false);
  }
  async function navigatePractice(url: string, invalidate = true) {
    if (!(await isServerReachable())) {
      window.location.assign(url);
      return;
    }
    await goto(url, { replaceState: true, invalidateAll: invalidate });
  }
  async function selectView(mode: "operational" | "quadri") {
    const nextSection = mode === "quadri" ? "quadri" : "overview";
    const search = new URLSearchParams(page.url.searchParams);
    search.set("vista", mode);
    search.set("sezione", nextSection);
    if (mode === "quadri" && !search.has("quadro")) search.set("quadro", "EA");
    await navigatePractice(`${page.url.pathname}?${search}`);
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
    await navigatePractice(`${page.url.pathname}?${search}`);
  }
  async function selectDeclaration(event: Event) {
    const declarationId = (event.currentTarget as HTMLSelectElement).value;
    const search = new URLSearchParams(page.url.searchParams);
    search.set("dichiarazione", declarationId);
    await navigatePractice(`${page.url.pathname}?${search}`);
  }
  async function chooseWorkspaceFile() {
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", "documents");
    search.set("vista", "operational");
    search.delete("documento");
    await navigatePractice(`${page.url.pathname}?${search}`);
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
    if (!(await isServerReachable())) {
      const offlinePractice = await getOfflinePractice(data.practice.id);
      if (offlinePractice?.status !== "complete") {
        resumableUploadError = "Questa pratica non è stata preparata per l’uso offline.";
        return;
      }
      await queueAttachment(data.practice.id, file);
      selectedFileName = "";
      if (input) input.value = "";
      offlineQueueMessage = "Allegato conservato sul dispositivo e in attesa di sincronizzazione.";
      window.dispatchEvent(new Event("sequent:offline-queue"));
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

  async function interceptOfflineForm(event: SubmitEvent) {
    const message = await interceptOfflinePracticeForm(event, data.practice.id);
    if (message) offlineQueueMessage = message;
  }
</script>

<svelte:window onsubmit={interceptOfflineForm} />
<svelte:head><title>{data.practice.title} · Sequent</title></svelte:head>
<div class="practice-page page-frame">
  <PracticeWorkspaceHeader
    practice={data.practice}
    declarations={data.declarations}
    selectedDeclarationId={data.declaration.id}
    {viewMode}
    renameActionUrl={formAction("rename")}
    renameError={form?.renameError}
    onSelectOperationalView={selectOperationalView}
    onSelectQuadriView={selectQuadriView}
    onSelectDeclaration={selectDeclaration}
    onChooseWorkspaceFile={chooseWorkspaceFile}
  >
    {#snippet offlineControls()}<OfflinePracticeControls {data} />{/snippet}
  </PracticeWorkspaceHeader>
  {#if offlineQueueMessage}<p class="offline-practice-message" role="status">{offlineQueueMessage}</p>{/if}

  <div class="practice-workspace">
    <PracticeWorkspaceNavigation
      {viewMode}
      {selectedSection}
      selectedQuadro={data.selectedQuadro}
      quadri={data.quadri}
      reviewCount={data.reviewItems.length}
      onSelectSection={selectSection}
      onSelectQuadro={selectQuadro}
    />

    <section class="workspace-main">
      {#key `${viewMode}:${selectedSection}:${data.selectedQuadro}:${data.declaration.id}`}
      <div class="workspace-section-stage" in:fly={{ y: 7, duration: 180 }} out:fade={{ duration: 90 }}>
      {#if data.activeJobs.length > 0}
        <ActiveProcessing jobs={data.activeJobs} />
      {/if}
      {#if form?.retryError}<p class="workspace-form-error" role="alert">{form.retryError}</p>{/if}
      {#if form?.cancelError}<p class="workspace-form-error" role="alert">{form.cancelError}</p>{/if}
      {#if viewMode === "quadri"}
        <QuadroFields {data} {form} actionUrl={formAction("saveFields", "quadri")} occurrenceActionUrl={formAction("manageOccurrence", "quadri")} duplicateActionUrl={formAction("duplicateSubjectEntry", "quadri")} />
        <section class="workspace-inline-support"><QuadroReferences {data} /></section>
      {:else if selectedSection === "overview"}
        <PracticeOverview {data} />
        <section class="workspace-inline-support"><PracticeContextPanel {data} /></section>
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
          <DocumentList documents={data.documents} selectedDocumentId={data.selectedDocument?.id ?? null} statusLabels={documentStatusLabels} />
        {/if}
        {#if data.selectedDocument}
          <section class="workspace-inline-support"><DocumentSourcePanel {data} {form} statusLabels={documentStatusLabels} {selectedSourceRef} /></section>
        {/if}
      {:else if selectedSection === "verifications"}
        <div class="workspace-panel-heading"><h2>Da verificare</h2><span>{data.reviewItems.length}</span></div>
        <div class="analysis-toolbar">
          <div><Bot size={20} /><span><strong>Analisi assistita</strong><small>Codex propone; la decisione resta tua.</small></span></div>
          <form method="POST" action={formAction("analyze", "verifications")}><button class="button secondary" type="submit" disabled={!data.codexEnabled || data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}>
            {#if !data.codexEnabled}<Bot size={17} />Codex non attivo{:else if data.activeJobs.some((job: { type: string }) => job.type === "codex.analyze_practice")}<LoaderCircle class="spinning" size={17} />Analisi in corso{:else}<Bot size={17} />{data.codexRuns.length > 0 ? "Rianalizza con Codex" : "Analizza con Codex"}{/if}
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
              <div class="review-values single-proposal"><div><span>Valore proposto</span><strong>{formatDisplayValue(data.selectedReview.proposedValue)}</strong></div></div>
              {#if data.selectedReview.alternatives.length > 0}<div class="review-alternatives"><span>Alternative</span><ul>{#each data.selectedReview.alternatives as alternative}<li>{formatDisplayValue(alternative)}</li>{/each}</ul></div>{/if}
              <dl>
                <div><dt>Metodo</dt><dd>{data.selectedReview.method === "codex" ? "Codex" : data.selectedReview.method === "ocr" ? "OCR" : data.selectedReview.method}</dd></div>
                <div><dt>Affidabilità</dt><dd>{data.selectedReview.confidence === null ? "Non dichiarata" : `${Math.round(data.selectedReview.confidence * 100)}%`}</dd></div>
                <div><dt>Fonte</dt><dd>{data.selectedReview.documentName ?? "—"}{data.selectedReview.pageNumber ? `, pagina ${data.selectedReview.pageNumber}` : ""}</dd></div>
                {#if selectedSourceRef?.excerpt ?? data.selectedReview.sourceExcerpt}<div><dt>Estratto</dt><dd class="source-excerpt">{selectedSourceRef?.excerpt ?? data.selectedReview.sourceExcerpt}</dd></div>{/if}
              </dl>
              <form class="review-decision-form" method="POST" action={formAction("review", "verifications")}>
                <input type="hidden" name="itemId" value={data.selectedReview.id} /><label for="review-edit">Correggi prima di confermare</label><input id="review-edit" name="value" value={editedValue} oninput={handleEditedValue} placeholder={formatDisplayValue(data.selectedReview.proposedValue)} maxlength="2000" />
                <div class="review-actions"><button class="button primary" type="submit" name="decision" value="confirmed" disabled={data.selectedReview.proposedValue === null}><Check size={17} />Conferma</button><button class="button secondary" type="submit" name="decision" value="edited" disabled={!editedValue.trim()}><Pencil size={17} />Conferma correzione</button><button class="button secondary" type="submit" name="decision" value="rejected"><X size={17} />Rifiuta</button><button class="button text" type="submit" name="decision" value="ignored">Ignora</button></div>
              </form>
            </section>
            <ReviewQueue items={data.reviewItems} selectedId={data.selectedReview.id} />
          </div>
        {/if}
        {#if data.selectedDocument || data.selectedReview}
          <section class="workspace-inline-support"><DocumentSourcePanel {data} {form} statusLabels={documentStatusLabels} {selectedSourceRef} /></section>
        {/if}
      {:else if selectedSection === "official"}
        <OfficialFlow {data} {form} actionUrl={(action) => formAction(action, "official")} />
      {:else if !selectedDomainSection}
        <div class="panel-empty workspace-empty"><LayoutDashboard size={27} /><p>Sezione non disponibile.</p><span>Torna alla panoramica della pratica.</span></div>
      {/if}
      {#if viewMode === "operational" && selectedDomainSection}
        <PracticeDomainSection
          {data}
          {form}
          selectedSection={selectedDomainSection}
          createDeclarationAction={formAction("createDeclaration", "overview")}
          addSubjectAction={formAction("addSubject", "people")}
          addAssetAction={formAction("addAsset", "estate")}
          checklistAction={formAction("updateChecklist", "documents")}
          saveDevolutionAction={formAction("saveDevolution", "devolution")}
          confirmDevolutionAction={formAction("confirmDevolution", "devolution")}
          runCalculationAction={formAction("runCalculation", "taxes")}
          confirmCalculationAction={formAction("confirmCalculation", "taxes")}
        />
      {/if}
      {#if viewMode === "operational" && data.operationalArea}
        <OperationalAreaFields
          {data}
          actionUrl={formAction("saveFields", selectedSection)}
          occurrenceActionUrl={formAction("manageOccurrence", selectedSection)}
          returnSection={selectedSection}
        />
        {#if form?.fieldError}<p class="workspace-form-error" role="alert">{form.fieldError}</p>{/if}
      {/if}
      {#if form?.domainError}<p class="workspace-form-error" role="alert">{form.domainError}</p>{/if}
      </div>
      {/key}
    </section>
  </div>
</div>
