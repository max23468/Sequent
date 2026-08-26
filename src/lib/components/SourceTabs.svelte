<script lang="ts">
  let { sourceRefs, documents, selectedDocumentId, reviewId } = $props<{
    sourceRefs: Array<{ documentId: string; value?: string | null }>;
    documents: Array<{ id: string; originalName: string }>;
    selectedDocumentId: string | null;
    reviewId: string;
  }>();

  function documentName(documentId: string): string | undefined {
    return documents.find((document: { id: string }) => document.id === documentId)?.originalName;
  }
</script>

<nav class="source-tabs" aria-label="Confronta fonti">
  {#each sourceRefs as source, index (`${source.documentId}-${index}`)}
    <a
      class:active={selectedDocumentId === source.documentId}
      href={`?sezione=verifications&verifica=${reviewId}&documento=${source.documentId}`}
      data-sveltekit-prefetch
    >
      <span>{documentName(source.documentId) ?? `Fonte ${index + 1}`}</span>
      {#if source.value}<small>{source.value}</small>{/if}
    </a>
  {/each}
</nav>
