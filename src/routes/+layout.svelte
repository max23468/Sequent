<script lang="ts">
  import "./app.css";

  let { children, data } = $props();
</script>

<svelte:head>
  <title>Sequent</title>
  <meta
    name="description"
    content="Assistente operativo privato per dichiarazioni di successione"
  />
</svelte:head>

{#if data.authenticated}
  <div class="app-shell">
    <header class="topbar">
      <a class="wordmark" href="/" data-sveltekit-preload-data="hover" data-sveltekit-prefetch>Sequent</a>
      <form method="POST" action="/logout">
        <button class="account-button" type="submit" aria-label="Disconnetti l’account">
          <span class="account-icon" aria-hidden="true">M</span>
          <span>Account</span>
        </button>
      </form>
    </header>
    <nav class="sidebar" aria-label="Navigazione principale">
      <a
        class="nav-item active"
        href="/"
        aria-current="page"
        data-sveltekit-preload-data="hover"
        data-sveltekit-prefetch
        ><span aria-hidden="true">▱</span> Pratiche</a
      >
      <span class="nav-item disabled" aria-disabled="true"><span aria-hidden="true">□</span> Documenti</span>
      <span class="nav-item disabled" aria-disabled="true"><span aria-hidden="true">✓</span> Attività</span>
      <span class="nav-item disabled" aria-disabled="true"><span aria-hidden="true">⌕</span> Ricerca</span>
      <span class="nav-item disabled" aria-disabled="true"><span aria-hidden="true">⚙</span> Impostazioni</span>
    </nav>
    <main class="main-content">{@render children()}</main>
    <footer class="status-footer"><span aria-hidden="true">▣</span> Salvataggio sicuro sulla tua istanza</footer>
  </div>
{:else}
  {@render children()}
{/if}
