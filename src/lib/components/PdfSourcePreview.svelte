<script lang="ts">
  import { FileText, LoaderCircle } from "@lucide/svelte";
  import { createPdfPreviewUrl } from "$lib/pdf-preview";

  const MAX_INLINE_PDF_BYTES = 32 * 1024 * 1024;

  let { resourceUrl, title, byteSize } = $props<{
    resourceUrl: string;
    title: string;
    byteSize: number;
  }>();

  let previewUrl = $state<string | null>(null);
  let previewState = $state<"loading" | "ready" | "error" | "too-large">("loading");

  $effect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    previewUrl = null;
    if (byteSize > MAX_INLINE_PDF_BYTES) {
      previewState = "too-large";
      return () => controller.abort();
    }
    previewState = "loading";

    void (async () => {
      try {
        objectUrl = await createPdfPreviewUrl(resourceUrl, controller.signal);
        if (controller.signal.aborted) return;
        previewUrl = objectUrl;
        previewState = "ready";
      } catch {
        if (!controller.signal.aborted) previewState = "error";
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
</script>

{#if previewState === "ready" && previewUrl}
  <iframe src={previewUrl} {title}></iframe>
{:else if previewState === "too-large"}
  <div class="panel-empty source-preview-empty" role="status">
    <FileText size={27} />
    <p>Anteprima non caricata per le dimensioni del PDF.</p>
    <span>Apri l’originale in una nuova scheda.</span>
  </div>
{:else if previewState === "error"}
  <div class="panel-empty source-preview-empty" role="alert">
    <FileText size={27} />
    <p>Anteprima PDF non disponibile.</p>
    <span>Apri l’originale in una nuova scheda.</span>
  </div>
{:else}
  <div class="panel-empty source-preview-empty" role="status">
    <LoaderCircle class="spinning" size={27} />
    <p>Caricamento anteprima…</p>
  </div>
{/if}
