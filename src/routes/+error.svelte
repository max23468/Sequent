<script lang="ts">
  import { page } from "$app/state";
  import BrandLogo from "$lib/components/BrandLogo.svelte";

  let destinationHref = $derived(
    page.data.authenticated ? "/" : page.data.needsSetup ? "/setup" : "/login",
  );
  let destinationLabel = $derived(
    page.data.authenticated
      ? "Torna alla Dashboard"
      : page.data.needsSetup
        ? "Torna alla configurazione"
        : "Vai all’accesso",
  );
</script>

<svelte:head>
  <title>{page.status === 404 ? "Pagina non trovata · Sequent" : "Errore · Sequent"}</title>
</svelte:head>

<main class:authenticated-error={page.data.authenticated} class="auth-page">
  <section class="auth-panel compact">
    {#if !page.data.authenticated}
      <BrandLogo href={destinationHref} label={`Sequent, ${destinationLabel}`} />
    {/if}
    <h1>Operazione non completata</h1>
    <p>{page.status === 404 ? "La pagina richiesta non esiste." : "Si è verificato un errore inatteso."}</p>
    <a
      class="button primary error-home"
      href={destinationHref}
      data-sveltekit-preload-data="hover"
      data-sveltekit-prefetch>{destinationLabel}</a
    >
  </section>
</main>
