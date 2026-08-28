<script lang="ts">
  import { Eye, FileText } from "@lucide/svelte";
  import { formatItalianDate, formatMegabytes } from "$lib/format";
  import SourceTabs from "$lib/components/SourceTabs.svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";

  let { data, statusLabels, selectedSourceRef } = $props<{
    data: PageData;
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
</script>

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
  <div class="source-metadata"><h3>{data.selectedDocument.originalName}</h3><dl><div><dt>Formato</dt><dd>{formatLabel(data.selectedDocument.detectedFormat, data.selectedDocument.mediaType)}</dd></div><div><dt>Stato</dt><dd>{statusLabels[data.selectedDocument.status] ?? data.selectedDocument.status}</dd></div><div><dt>Dimensione</dt><dd>{formatMegabytes(data.selectedDocument.byteSize)}</dd></div><div><dt>Caricato</dt><dd>{formatItalianDate(data.selectedDocument.createdAt)}</dd></div></dl><a class="button text source-open" href={`/api/documents/${data.selectedDocument.id}/content`} target="_blank" rel="noreferrer"><Eye size={16} />Apri originale</a></div>
{:else}
  <div class="panel-empty source-empty"><FileText size={27} /><p>Nessuna fonte selezionata.</p><span>Seleziona un documento o una verifica per consultarne la fonte.</span></div>
{/if}
