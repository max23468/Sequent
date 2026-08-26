<script lang="ts">
  import { Eye } from "@lucide/svelte";

  let { items, selectedId } = $props<{
    items: Array<{
      id: string;
      label: string;
      documentName: string | null;
      pageNumber: number | null;
    }>;
    selectedId: string;
  }>();

</script>

{#if items.length > 1}
  <div class="review-queue-heading">Altre verifiche</div>
  <ul class="review-queue">
    {#each items as item (item.id)}
      {#if item.id !== selectedId}
        <li>
          <a href={`?sezione=verifications&verifica=${item.id}`}>
            <span>
              <strong>{item.label}</strong>
              <small>{item.documentName ?? "Senza documento"}{item.pageNumber ? ` · pag. ${item.pageNumber}` : ""}</small>
            </span>
            <Eye size={17} />
          </a>
        </li>
      {/if}
    {/each}
  </ul>
{/if}
