<script lang="ts">
  import { FileText, Folder, Search, X } from "@lucide/svelte";
  import { searchSequent, type SearchResult } from "$lib/client/search";

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let open = $state(false);
  let loading = $state(false);
  let requestId = 0;

  async function search() {
    const current = query.trim();
    const id = ++requestId;
    if (!current) {
      results = [];
      open = false;
      return;
    }
    loading = true;
    open = true;
    const nextResults = await searchSequent(current);
    if (id !== requestId) return;
    results = nextResults;
    loading = false;
  }

  function clear() {
    query = "";
    results = [];
    open = false;
  }

  function handleFocus() {
    if (query.trim()) open = true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      open = false;
      return;
    }
    if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      document.querySelector<HTMLAnchorElement>("#global-search-results a")?.focus();
      return;
    }
    if (event.key === "Enter" && open && results.length > 0) {
      event.preventDefault();
      window.location.href = results[0]!.href;
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    const isSearchShortcut =
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") ||
      (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping);
    if (isSearchShortcut) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#global-search")?.focus();
      if (query.trim()) open = true;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="search-box" role="search">
  <Search size={19} strokeWidth={1.8} aria-hidden="true" />
  <label class="sr-only" for="global-search">Cerca in Sequent</label>
  <input
    id="global-search"
    type="search"
    placeholder="Cerca in Sequent"
    autocomplete="off"
    bind:value={query}
    oninput={search}
    onfocus={handleFocus}
    onkeydown={handleKeydown}
  />
  {#if query}
    <button class="icon-button search-clear" type="button" aria-label="Cancella ricerca" onclick={clear}>
      <X size={17} aria-hidden="true" />
    </button>
  {/if}
  {#if open}
    <div
      id="global-search-results"
      class="search-results"
      aria-live="polite"
    >
      {#if loading}
        <p class="search-message">Ricerca…</p>
      {:else if results.length === 0}
        <p class="search-message">Nessun risultato.</p>
      {:else}
        <ul>
          {#each results as result (result.kind + result.id)}
            <li>
              <a href={result.href} onclick={clear}>
                {#if result.kind === "practice"}<Folder size={18} aria-hidden="true" />{:else}<FileText size={18} aria-hidden="true" />{/if}
                <span><strong>{result.label}</strong><small>{result.context}</small></span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
