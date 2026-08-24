<script lang="ts">
  import { page } from "$app/state";
</script>

<main class="auth-page">
  <section class="auth-panel compact">
    <a class="wordmark" href="/" data-sveltekit-preload-data="hover" data-sveltekit-prefetch>Sequent</a>
    <h1>Operazione non completata</h1>
    <p>{page.status === 404 ? "La pagina richiesta non esiste." : "Si è verificato un errore inatteso."}</p>
    <a
      class="primary-button error-home"
      href="/"
      data-sveltekit-preload-data="hover"
      data-sveltekit-prefetch>Torna alle pratiche</a
    >
  </section>
</main>
