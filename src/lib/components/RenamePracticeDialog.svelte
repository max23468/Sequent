<script lang="ts">
  import { Check, X } from "@lucide/svelte";

  let {
    actionUrl,
    title,
    error,
  }: { actionUrl: string; title: string; error?: string } = $props();
  // oxlint-disable-next-line no-unassigned-vars -- Svelte assegna il nodo tramite bind:this.
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (error && dialog && !dialog.open) dialog.showModal();
  });

  export function show() {
    dialog?.showModal();
  }

  function close() {
    dialog?.close();
  }
</script>

<dialog class="app-dialog" bind:this={dialog} aria-labelledby="rename-practice-title">
  <form method="POST" action={actionUrl}>
    <div class="dialog-heading">
      <div>
        <p class="dialog-kicker">Pratica</p>
        <h2 id="rename-practice-title">Rinomina pratica</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Chiudi" onclick={close}
        ><X size={20} /></button
      >
    </div>
    <label for="renamed-practice-title">Nome della pratica</label>
    <input
      id="renamed-practice-title"
      name="title"
      value={title}
      maxlength="120"
      required
    />
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="dialog-actions">
      <button class="button text" type="button" onclick={close}>Annulla</button>
      <button class="button primary" type="submit"><Check size={18} />Salva</button>
    </div>
  </form>
</dialog>
