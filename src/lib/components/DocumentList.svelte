<script lang="ts">
  import { FileText, LoaderCircle } from "@lucide/svelte";
  import { formatMegabytes } from "$lib/format";

  let { documents, selectedDocumentId, statusLabels } = $props<{
    documents: Array<{
      id: string;
      originalName: string;
      byteSize: number;
      status: string;
      pageCount: number | null;
    }>;
    selectedDocumentId: string | null;
    statusLabels: Record<string, string>;
  }>();
</script>

<ul class="document-list">
  {#each documents as file (file.id)}
    <li class:selected={selectedDocumentId === file.id}>
      <a href={`?sezione=documents&documento=${file.id}`}>
        {#if ["processing", "classifying", "received"].includes(file.status)}
          <LoaderCircle class="spinning" size={20} />
        {:else}
          <FileText size={20} />
        {/if}
        <span>
          <strong>{file.originalName}</strong>
          <small>{formatMegabytes(file.byteSize)} · {statusLabels[file.status] ?? file.status}{file.pageCount ? ` · ${file.pageCount} pag.` : ""}</small>
        </span>
      </a>
    </li>
  {/each}
</ul>
