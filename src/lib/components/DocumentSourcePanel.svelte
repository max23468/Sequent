<script lang="ts">
  import { Eye, FileText } from "@lucide/svelte";
  import { formatItalianDate, formatMegabytes } from "$lib/format";
  import PdfSourcePreview from "$lib/components/PdfSourcePreview.svelte";
  import SourceTabs from "$lib/components/SourceTabs.svelte";
  import type { ActionData, PageData } from "../../routes/pratiche/[id]/$types";

  let { data, form, statusLabels, selectedSourceRef } = $props<{
    data: PageData;
    form: ActionData | null;
    statusLabels: Record<string, string>;
    selectedSourceRef: { pageNumber?: number | null } | undefined;
  }>();
  const selectedReviewPage = $derived(
    selectedSourceRef?.pageNumber ?? data.selectedReview?.pageNumber ?? null,
  );
  const selectedSourcePage = $derived(
    selectedReviewPage
      ? data.selectedDocumentPages.find(
          (candidate: { pageNumber: number }) => candidate.pageNumber === selectedReviewPage,
        )
      : data.selectedDocumentPages.at(0),
  );
  function formatLabel(format: string | null | undefined, mediaType: string): string {
    if (format === "DIZ") return "Archivio della dichiarazione";
    if (format === "ZIP") return "Archivio compresso";
    if (format) return format;
    if (mediaType === "application/pdf") return "PDF";
    if (mediaType.startsWith("image/")) return "Immagine";
    if (mediaType.startsWith("text/")) return "Testo";
    return "Documento";
  }
  function preparedFiles() {
    return data.officialAttachments.filter(
      (attachment: { documentId: string }) => attachment.documentId === data.selectedDocument?.id,
    );
  }
</script>

<div class="workspace-panel-heading"><h2>Fonte</h2>{#if data.selectedReview?.pageNumber}<span>Pag. {data.selectedReview.pageNumber}</span>{/if}</div>
{#if data.selectedReview && data.selectedReview.sourceRefs.length > 1}
  <SourceTabs sourceRefs={data.selectedReview.sourceRefs} documents={data.documents} selectedDocumentId={data.selectedDocument?.id ?? null} reviewId={data.selectedReview.id} />
{/if}
{#if data.selectedDocument}
  <div class="source-viewer">
    {#if data.selectedDocument.mediaType.startsWith("image/")}<img src={`/api/documents/${data.selectedDocument.id}/content`} alt={`Originale ${data.selectedDocument.originalName}`} />
    {:else if data.selectedDocument.mediaType === "application/pdf"}<PdfSourcePreview resourceUrl={`/api/documents/${data.selectedDocument.id}/content`} title={`Originale ${data.selectedDocument.originalName}`} byteSize={data.selectedDocument.byteSize} />
    {:else if selectedSourcePage}<pre>{selectedSourcePage.text || "Nessun testo estraibile."}</pre>
    {:else}<div class="panel-empty source-preview-empty"><FileText size={27} /><p>Anteprima non disponibile.</p><span>L’originale è conservato e può essere aperto separatamente.</span></div>{/if}
  </div>
  <div class="source-metadata"><h3>{data.selectedDocument.originalName}</h3><dl><div><dt>Formato</dt><dd>{formatLabel(data.selectedDocument.detectedFormat, data.selectedDocument.mediaType)}</dd></div><div><dt>Stato</dt><dd>{statusLabels[data.selectedDocument.status] ?? data.selectedDocument.status}</dd></div><div><dt>Dimensione</dt><dd>{formatMegabytes(data.selectedDocument.byteSize)}</dd></div><div><dt>Caricato</dt><dd>{formatItalianDate(data.selectedDocument.createdAt)}</dd></div></dl><a class="button text source-open" href={`/api/documents/${data.selectedDocument.id}/content`} target="_blank" rel="noreferrer"><Eye size={16} />Apri originale</a></div>
  <section class="prepared-attachments">
    <header><strong>Allegato per la dichiarazione</strong><small>PDF/A-1b o TIFF controllato, massimo 5 MB per file.</small></header>
    {#if preparedFiles().length > 0}
      <ul>{#each preparedFiles() as attachment (attachment.id)}<li><span><strong>{attachment.preparedName}</strong><small>{attachment.format} · {formatMegabytes(attachment.byteSize)}</small></span><a class="button text" href={`/api/attachments/${attachment.id}/content`} target="_blank" rel="noreferrer">Apri</a></li>{/each}</ul>
    {:else}
      <p>L’originale resta invariato; la procedura crea e controlla una copia adatta all’invio.</p>
    {/if}
    <form method="POST" action="?/prepareAttachment"><input type="hidden" name="documentId" value={data.selectedDocument.id} /><button class="button secondary" type="submit">{preparedFiles().length > 0 ? "Prepara di nuovo" : "Prepara allegato"}</button></form>
    {#if form?.attachmentError}<p class="workspace-form-error" role="alert">{form.attachmentError}</p>{/if}
  </section>
{:else}
  <div class="panel-empty source-empty"><FileText size={27} /><p>Nessuna fonte selezionata.</p><span>Seleziona un documento o una verifica per consultarne la fonte.</span></div>
{/if}
