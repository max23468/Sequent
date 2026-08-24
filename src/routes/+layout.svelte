<script lang="ts">
  import { page } from "$app/state";
  import { browser } from "$app/environment";
  import { FileText, Folder, Home, Moon, Settings, Sun, UserRound } from "@lucide/svelte";
  import BrandLogo from "$lib/components/BrandLogo.svelte";
  import SearchBox from "$lib/components/SearchBox.svelte";
  import "./app.css";

  let { children, data } = $props();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/pratiche", label: "Pratiche", icon: Folder },
    { href: "/documenti", label: "Documenti", icon: FileText },
    { href: "/impostazioni", label: "Impostazioni", icon: Settings },
  ];

  function isActive(href: string) {
    return href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);
  }

  function setTheme(theme: "system" | "light" | "dark") {
    if (!browser) return;
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("sequent-theme");
      return;
    }
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sequent-theme", theme);
  }

  function setLightTheme() {
    setTheme("light");
  }

  function setDarkTheme() {
    setTheme("dark");
  }

  function setSystemTheme() {
    setTheme("system");
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
          <summary aria-label="Apri menu utente"><UserRound size={21} aria-hidden="true" /><span>Utente</span></summary>
          <div class="account-popover">
            <p>Tema</p>
            <div class="theme-actions">
              <button type="button" onclick={setLightTheme}><Sun size={17} /> Chiaro</button>
              <button type="button" onclick={setDarkTheme}><Moon size={17} /> Scuro</button>
              <button type="button" onclick={setSystemTheme}>Sistema</button>
            </div>
            <form method="POST" action="/logout"><button type="submit">Esci</button></form>
          </div>
        </details>
      </div>
    </header>
    <main class="main-content">{@render children()}</main>
    <nav class="mobile-navigation" aria-label="Navigazione principale mobile">
      {#each navItems as item (item.href)}
        <a class:active={isActive(item.href)} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
          <item.icon size={25} strokeWidth={1.8} aria-hidden="true" />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{:else}
  {@render children()}
{/if}
