<script lang="ts">
  import { page } from "$app/state";
  import { ChevronDown, FileText, Folder, Home, Menu, Settings, UserRound } from "@lucide/svelte";
  import BrandLogo from "$lib/components/BrandLogo.svelte";
  import SearchBox from "$lib/components/SearchBox.svelte";
  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  import "./app.css";

  let { children, data } = $props();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/pratiche", label: "Pratiche", icon: Folder },
    { href: "/documenti", label: "Documenti", icon: FileText },
    { href: "/impostazioni", label: "Impostazioni", icon: Settings },
  ];

  function isActive(href: string) {
    return href === "/"
      ? page.url.pathname === "/" || page.url.pathname === "/__design"
      : page.url.pathname.startsWith(href);
  }

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
        <details class="account-menu">
          <summary aria-label="Apri menu utente">
            <span class="account-avatar"><UserRound size={19} aria-hidden="true" /></span>
            <span class="account-label">Utente</span>
            <ChevronDown class="account-chevron" size={16} aria-hidden="true" />
            <Menu class="account-mobile-menu" size={18} aria-hidden="true" />
          </summary>
          <div class="account-popover">
            <p>Tema</p>
            <ThemeSelector compact />
            <form method="POST" action="/logout"><button type="submit">Esci</button></form>
          </div>
        </details>
      </div>
    </header>
    <main class="main-content">{@render children()}</main>
    <nav class="mobile-navigation" aria-label="Navigazione principale mobile">
      {#each navItems as item (item.href)}
        <a class:active={isActive(item.href)} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
          <item.icon
            size={25}
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
