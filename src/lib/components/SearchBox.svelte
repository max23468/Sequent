<script lang="ts">
  import { Building2, FileText, Folder, Search, UsersRound, X } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { searchSequent, type SearchResult } from "$lib/client/search";

  let query = $state("");
  let results = $state<SearchResult[]>([]);
  let open = $state(false);
  let mobileOpen = $state(false);
  let loading = $state(false);
  let requestId = 0;
  let debounceTimer: number | undefined;
  let searchController: AbortController | undefined;
  const searchDelayMs = 250;
  const resultIcons = {
    practice: Folder,
    document: FileText,
    subject: UsersRound,
    asset: Building2,
  } as const;

  async function runSearch(current: string, id: number) {
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    try {
      const nextResults = await searchSequent(current, controller.signal);
      if (id !== requestId) return;
      results = nextResults;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (id === requestId) results = [];
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function scheduleSearch() {
    window.clearTimeout(debounceTimer);
    searchController?.abort();
    const current = query.trim();
    const id = ++requestId;
    if (!current) {
      searchController?.abort();
      results = [];
      open = false;
      loading = false;
      return;
    }
    loading = true;
    open = true;
    debounceTimer = window.setTimeout(() => void runSearch(current, id), searchDelayMs);
  }

  function clear() {
    window.clearTimeout(debounceTimer);
    searchController?.abort();
    requestId += 1;
    query = "";
    results = [];
    open = false;
    mobileOpen = false;
  }

  function openMobileSearch() {
    mobileOpen = true;
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>("#global-search")?.focus(),
    );
  }

  function closeMobileSearch() {
    clear();
    document.querySelector<HTMLInputElement>("#global-search")?.blur();
  }

  function handleFocus() {
    if (query.trim()) open = true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (mobileOpen) closeMobileSearch();
      else open = false;
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
      openMobileSearch();
      if (query.trim()) open = true;
    }
  }

  $effect(() => {
    return () => {
      window.clearTimeout(debounceTimer);
      searchController?.abort();
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class:mobile-open={mobileOpen} class="search-box" role="search">
  <button
    class="icon-button mobile-search-trigger"
    type="button"
    aria-label="Apri ricerca"
    aria-expanded={mobileOpen}
    onclick={openMobileSearch}
  >
    <Search size={19} strokeWidth={1.8} aria-hidden="true" />
  </button>
  <Search class="search-inline-icon" size={19} strokeWidth={1.8} aria-hidden="true" />
  <label class="sr-only" for="global-search">Cerca in Sequent</label>
  <input
    id="global-search"
    type="search"
    placeholder="Cerca in Sequent"
    autocomplete="off"
    bind:value={query}
    oninput={scheduleSearch}
    onfocus={handleFocus}
    onkeydown={handleKeydown}
  />
  {#if query}
    <button class="icon-button search-clear" type="button" aria-label="Cancella ricerca" onclick={clear}>
      <X size={17} aria-hidden="true" />
    </button>
  {/if}
  <button
    class="icon-button search-close"
    type="button"
    aria-label="Chiudi ricerca"
    onclick={closeMobileSearch}
  >
    <X size={18} aria-hidden="true" />
  </button>
  {#if open}
    <div
      id="global-search-results"
      class="search-results"
      aria-live="polite"
      transition:fly={{ y: -6, duration: 150 }}
    >
      {#if loading}
        <p class="search-message">Ricerca…</p>
      {:else if results.length === 0}
        <p class="search-message">Nessun risultato.</p>
      {:else}
        <ul>
          {#each results as result (result.kind + result.id)}
            {@const ResultIcon = resultIcons[result.kind]}
            <li>
              <a href={result.href} onclick={clear}>
                <ResultIcon size={18} aria-hidden="true" />
                <span><strong>{result.label}</strong><small>{result.context}</small></span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
