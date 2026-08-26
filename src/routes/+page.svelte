<script lang="ts">
  import { CalendarClock, ChevronRight, ExternalLink, FolderOpen, History, MoreVertical, Plus, Upload, X } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";
  import { uploadFilesResumably } from "$lib/client/resumable-upload";

  let { data, form } = $props();
  let createDialog: HTMLDialogElement | undefined = undefined;
  let uploadDialog: HTMLDialogElement | undefined = undefined;
  let launcherDialog: HTMLDialogElement | undefined = undefined;
  let quickActionsOpen = $state(false);
  let selectedLauncher = $state<(typeof data.launchers)[number] | null>(null);
  let uploadProgress = $state<number | null>(null);
  let uploadCurrentFile = $state("");
  let resumableUploadError = $state("");

  $effect(() => {
    if (form?.createError) createDialog?.showModal();
    if (form?.uploadError) uploadDialog?.showModal();
  });

  function openLauncher(launcher: (typeof data.launchers)[number]) {
    if (launcher.state === "available" && launcher.url) {
      window.location.href = launcher.url;
      return;
    }
    selectedLauncher = launcher;
    launcherDialog?.showModal();
  }

  function handleLauncherClick(event: MouseEvent) {
    const id = (event.currentTarget as HTMLButtonElement).dataset.launcherId;
    const launcher = data.launchers.find((item: (typeof data.launchers)[number]) => item.id === id);
    if (launcher) openLauncher(launcher);
  }

  function showCreateDialog() {
    createDialog?.showModal();
  }

  function closeCreateDialog() {
    createDialog?.close();
  }

  function showUploadDialog() {
    uploadDialog?.showModal();
  }

  function showUploadFromQuickActions() {
    quickActionsOpen = false;
    uploadDialog?.showModal();
  }

  function closeUploadDialog() {
    uploadDialog?.close();
  }

  function toggleQuickActions() {
    quickActionsOpen = !quickActionsOpen;
  }

  function closeLauncherDialog() {
    launcherDialog?.close();
  }

  async function uploadFromDashboard(event: SubmitEvent) {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const formData = new FormData(formElement);
    const files = formData
      .getAll("file")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const practiceId = String(formData.get("practiceId") ?? "");
    const newPracticeTitle = String(formData.get("newTitle") ?? "").trim();
    if (files.length === 0) {
      resumableUploadError = "Scegli un documento da caricare.";
      return;
    }
    if (!practiceId && !newPracticeTitle) {
      resumableUploadError = "Scegli una pratica o assegna un nome a quella nuova.";
      return;
    }
    resumableUploadError = "";
    uploadProgress = 0;
    try {
      const result = await uploadFilesResumably(
        files,
        practiceId ? { practiceId } : { newPracticeTitle },
        (progress, fileName) => {
          uploadProgress = progress;
          uploadCurrentFile = fileName;
        },
      );
      window.location.assign(result.location);
    } catch (error) {
      resumableUploadError =
        error instanceof Error && !error.message.startsWith("{")
          ? error.message
          : "Caricamento interrotto. Riseleziona gli stessi file per riprenderlo.";
      uploadProgress = null;
    }
  }

</script>

<svelte:head><title>Dashboard · Sequent</title></svelte:head>

<div class="dashboard-page page-frame">
  <div class="dashboard-heading">
    <h1>Dashboard</h1>
    <div class="desktop-quick-actions" aria-label="Azioni Dashboard">
      {#each data.launchers as launcher (launcher.id)}
        <button class="action-link launcher-action" type="button" data-launcher-id={launcher.id} onclick={handleLauncherClick}>
          <ExternalLink size={18} strokeWidth={1.7} aria-hidden="true" />{launcher.label}
        </button>
      {/each}
      {#if data.lastPractice}
        <a class="action-link" href={`/pratiche/${data.lastPractice.id}`}><History size={19} strokeWidth={1.7} aria-hidden="true" />Riprendi ultima pratica</a>
      {/if}
      <button class="button secondary" type="button" onclick={showUploadDialog}><Upload size={18} strokeWidth={1.8} aria-hidden="true" />Carica documenti</button>
      <button class="button primary" type="button" onclick={showCreateDialog}><Plus size={20} strokeWidth={1.8} aria-hidden="true" />Nuova pratica</button>
    </div>
    <div class="mobile-heading-actions">
      <button class="button primary" type="button" onclick={showCreateDialog}><Plus size={23} aria-hidden="true" />Nuova</button>
      <div class="quick-actions-menu">
        <button class="button icon-only" type="button" aria-label="Azioni rapide" aria-expanded={quickActionsOpen} onclick={toggleQuickActions}><MoreVertical size={25} aria-hidden="true" /></button>
        <span>Azioni rapide</span>
        {#if quickActionsOpen}
          <div class="quick-actions-popover">
            <button type="button" onclick={showUploadFromQuickActions}><Upload size={18} />Carica documenti</button>
            {#if data.lastPractice}<a href={`/pratiche/${data.lastPractice.id}`}><History size={18} />Riprendi ultima pratica</a>{/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="dashboard-grid">
    <section class="dashboard-panel attention-panel" aria-labelledby="attention-title">
      <div class="panel-title dashboard-panel-title">
        <span class="mobile-panel-mark attention-mark" aria-hidden="true"></span>
        <h2 id="attention-title">Da verificare</h2>
      </div>
      {#if data.failedVerifications.length === 0 && data.pendingReviews.length === 0}
        <div class="panel-empty"><p>Nessuna verifica da mostrare.</p><span>Le verifiche documentali compariranno qui quando saranno disponibili.</span></div>
      {:else}
        <ul class="verification-list">
          {#each data.pendingReviews.slice(0, 8) as review (review.id)}
            <li>
              <a href={`/pratiche/${review.practiceId}?sezione=verifications&verifica=${review.id}`}>
                <span><strong>{review.label}</strong><small>{review.documentName ?? "Senza documento"} · {review.practiceTitle} · {review.method === "codex" ? "Codex" : review.method === "ocr" ? "OCR" : review.method}</small></span>
                <ChevronRight size={19} aria-hidden="true" />
              </a>
            </li>
          {/each}
          {#each data.failedVerifications as verification (verification.jobId)}
            <li>
              <a href={`/pratiche/${verification.practiceId}?documento=${verification.documentId}`}>
                <span><strong>Verifica tecnica non riuscita</strong><small>{verification.documentName} · {verification.practiceTitle}</small></span>
                <ChevronRight size={19} aria-hidden="true" />
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <section class="dashboard-panel deadlines-panel" aria-labelledby="deadlines-title">
      <div class="panel-title dashboard-panel-title">
        <span class="mobile-panel-mark" aria-hidden="true"><CalendarClock size={21} /></span>
        <h2 id="deadlines-title">Scadenze</h2>
      </div>
      <div class="panel-empty"><p>Nessuna scadenza registrata.</p><span>Sequent mostrerà soltanto le scadenze essenziali della pratica.</span></div>
    </section>
    <section class="dashboard-panel recent-panel" aria-labelledby="recent-title">
      <div class="panel-title dashboard-panel-title">
        <span class="mobile-panel-mark" aria-hidden="true"><History size={21} /></span>
        <h2 id="recent-title">Pratiche recenti</h2>
      </div>
      {#if data.practices.length === 0}
        <div class="panel-empty recent-empty"><p>Non ci sono ancora pratiche.</p><span>Crea la prima pratica o carica un documento per iniziare.</span></div>
      {:else}
        <div class="responsive-table">
          <div class="table-row table-header" aria-hidden="true"><span>Pratica</span><span>Documenti</span><span>Revisione</span><span>Aggiornato</span><span></span></div>
          {#each data.practices.slice(0, 6) as practice (practice.id)}
            <a class="table-row practice-row" href={`/pratiche/${practice.id}`}>
              <strong>{practice.title}</strong><span>{practice.documentCount}</span><span>{practice.revision}</span>
              <time datetime={practice.updatedAt}>{formatItalianDate(practice.updatedAt)}</time><ChevronRight size={19} aria-hidden="true" />
            </a>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<dialog class="app-dialog" bind:this={createDialog} aria-labelledby="create-title">
  <form method="POST" action="?/create">
    <div class="dialog-heading"><div><p class="dialog-kicker">Nuova pratica</p><h2 id="create-title">Assegna un nome alla pratica</h2></div><button class="icon-button" type="button" aria-label="Chiudi" onclick={closeCreateDialog}><X size={20} /></button></div>
    <label for="practice-title">Nome della pratica</label><input id="practice-title" name="title" maxlength="120" required />
    {#if form?.createError}<p class="form-error" role="alert">{form.createError}</p>{/if}
    <div class="dialog-actions"><button class="button text" type="button" onclick={closeCreateDialog}>Annulla</button><button class="button primary" type="submit"><Plus size={18} />Crea pratica</button></div>
  </form>
</dialog>

<dialog class="app-dialog wide" bind:this={uploadDialog} aria-labelledby="upload-title">
  <form method="POST" action="?/upload" enctype="multipart/form-data" onsubmit={uploadFromDashboard}>
    <div class="dialog-heading"><div><p class="dialog-kicker">Carica documenti</p><h2 id="upload-title">Scegli la pratica di destinazione</h2></div><button class="icon-button" type="button" aria-label="Chiudi" onclick={closeUploadDialog}><X size={20} /></button></div>
    {#if data.practices.length > 0}
      <label for="upload-practice">Pratica esistente</label><select id="upload-practice" name="practiceId"><option value="">Crea una nuova pratica</option>{#each data.practices as practice (practice.id)}<option value={practice.id}>{practice.title}</option>{/each}</select>
    {/if}
    <label for="new-practice-title">Nome della nuova pratica</label><input id="new-practice-title" name="newTitle" maxlength="120" placeholder="Usato solo se non scegli una pratica esistente" />
    <label for="document-file">Documento</label><input id="document-file" name="file" type="file" multiple required />
    {#if uploadProgress !== null}<progress class="upload-progress" max="100" value={uploadProgress}></progress><p class="dialog-note">{uploadProgress}% · {uploadCurrentFile}</p>{/if}
    {#if resumableUploadError}<p class="form-error" role="alert">{resumableUploadError}</p>{/if}
    {#if form?.uploadError}<p class="form-error" role="alert">{form.uploadError}</p>{/if}
    <div class="dialog-actions"><button class="button text" type="button" onclick={closeUploadDialog}>Annulla</button><button class="button primary" type="submit" disabled={uploadProgress !== null}><Upload size={18} />{uploadProgress === null ? "Carica" : "Caricamento…"}</button></div>
  </form>
</dialog>

<dialog class="app-dialog" bind:this={launcherDialog} aria-labelledby="launcher-title">
  {#if selectedLauncher}
    <div class="dialog-heading"><div><p class="dialog-kicker">Scorciatoia locale</p><h2 id="launcher-title">{selectedLauncher.label}</h2></div><button class="icon-button" type="button" aria-label="Chiudi" onclick={closeLauncherDialog}><X size={20} /></button></div>
    <div class="launcher-instructions"><FolderOpen size={24} aria-hidden="true" /><p>{selectedLauncher.instructions}</p></div>
    <p class="dialog-note">Questa azione non invia dati e non automatizza operazioni fiscali.</p>
    <div class="dialog-actions"><button class="button primary" type="button" onclick={closeLauncherDialog}>Ho capito</button></div>
  {/if}
</dialog>
