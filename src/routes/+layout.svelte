<script lang="ts">
  import { page } from "$app/state";
  import { ChevronDown, FileText, Folder, Home, Menu, Settings, UserRound } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import BrandLogo from "$lib/components/BrandLogo.svelte";
  import SearchBox from "$lib/components/SearchBox.svelte";
  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  import { resolvePageTitle } from "$lib/page-title";
  import "./app.css";

  let { children, data } = $props();
  let accountMenuOpen = $state(false);

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/pratiche", label: "Pratiche", icon: Folder },
    { href: "/documenti", label: "Documenti", icon: FileText },
    { href: "/impostazioni", label: "Impostazioni", icon: Settings },
  ];

  let browserTitle = $derived(resolvePageTitle(page.url.pathname));
  let routeKey = $derived(page.url.pathname);

  function isActive(href: string) {
    return href === "/"
      ? page.url.pathname === "/" || page.url.pathname === "/__design"
      : page.url.pathname.startsWith(href);
  }

  function handleShellPointerDown(event: PointerEvent) {
    const insideAccountMenu = event
      .composedPath()
      .some((target) => target instanceof Element && target.classList.contains("account-menu"));
    if (accountMenuOpen && !insideAccountMenu) accountMenuOpen = false;
  }

  function handleShellKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !accountMenuOpen) return;
    accountMenuOpen = false;
    document.querySelector<HTMLElement>(".account-menu-trigger")?.focus();
  }

  function toggleAccountMenu() {
    accountMenuOpen = !accountMenuOpen;
  }

  async function clearOfflineCopiesBeforeLogout(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const { clearAllOfflineData } = await import("$lib/offline/store");
    await clearAllOfflineData();
    form.submit();
  }
</script>

<svelte:window onpointerdown={handleShellPointerDown} onkeydown={handleShellKeydown} />

<svelte:head>
  <title>{browserTitle}</title>
  <meta
    name="description"
    content="Assistente operativo privato per dichiarazioni di successione"
  />
  <meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

{#if data.authenticated}
  <div class="app-shell">
    <header class="topbar">
      <BrandLogo />
      <span class="topbar-divider" aria-hidden="true"></span>
      <nav class="desktop-navigation" aria-label="Navigazione principale">
        {#each navItems as item (item.href)}
          <a class:active={isActive(item.href)} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
            <item.icon size={20} strokeWidth={1.7} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
      <div class="topbar-tools">
        <SearchBox />
        <div class="account-menu">
          <button
            class="account-menu-trigger"
            type="button"
            aria-label="Apri menu utente"
            aria-expanded={accountMenuOpen}
            onclick={toggleAccountMenu}
          >
            <span class="account-avatar"><UserRound size={19} aria-hidden="true" /></span>
            <span class="account-label">{data.username ?? "Utente"}</span>
            <ChevronDown class={`account-chevron${accountMenuOpen ? " open" : ""}`} size={16} aria-hidden="true" />
            <Menu class="account-mobile-menu" size={18} aria-hidden="true" />
          </button>
          {#if accountMenuOpen}
            <div class="account-popover" transition:fly={{ y: -6, duration: 150 }}>
              <p>Tema</p>
              <ThemeSelector compact />
              <form method="POST" action="/logout" onsubmit={clearOfflineCopiesBeforeLogout}><button type="submit">Esci</button></form>
            </div>
          {/if}
        </div>
      </div>
    </header>
    <main class="main-content">
      {#key routeKey}
        <div class="route-stage" in:fly={{ y: 7, duration: 190 }} out:fade={{ duration: 90 }}>
          {@render children()}
        </div>
      {/key}
    </main>
    <nav class="mobile-navigation" aria-label="Navigazione principale mobile">
      {#each navItems as item (item.href)}
        <a class:active={isActive(item.href)} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
          <item.icon
            size={22}
            strokeWidth={1.8}
            fill={item.href === "/" && isActive(item.href) ? "currentColor" : "none"}
            aria-hidden="true"
          />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{:else}
  {@render children()}
{/if}
