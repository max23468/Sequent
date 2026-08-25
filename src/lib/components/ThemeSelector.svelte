<script lang="ts">
  import { browser } from "$app/environment";
  import { Monitor, Moon, Sun } from "@lucide/svelte";

  type ThemePreference = "system" | "light" | "dark";

  let { compact = false } = $props<{ compact?: boolean }>();
  let preference = $state<ThemePreference>("system");

  const options = [
    { value: "system", label: "Sistema", icon: Monitor },
    { value: "light", label: "Chiaro", icon: Sun },
    { value: "dark", label: "Scuro", icon: Moon },
  ] as const;

  function readPreference(): ThemePreference {
    if (!browser) return "system";
    const stored = localStorage.getItem("sequent-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  }

  function setTheme(next: ThemePreference) {
    if (!browser) return;
    preference = next;

    if (next === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem("sequent-theme");
    } else {
      document.documentElement.dataset.theme = next;
      localStorage.setItem("sequent-theme", next);
    }

    window.dispatchEvent(new CustomEvent<ThemePreference>("sequent-theme-change", { detail: next }));
  }

  function handleClick(event: MouseEvent) {
    const next = (event.currentTarget as HTMLButtonElement).dataset.theme as ThemePreference;
    setTheme(next);
  }

  $effect(() => {
    preference = readPreference();
    const handleChange = (event: Event) => {
      preference = (event as CustomEvent<ThemePreference>).detail;
    };
    window.addEventListener("sequent-theme-change", handleChange);
    return () => window.removeEventListener("sequent-theme-change", handleChange);
  });
</script>

<div class:compact class="theme-selector" role="group" aria-label="Tema dell’interfaccia">
  {#each options as option (option.value)}
    {@const Icon = option.icon}
    <button
      type="button"
      class:active={preference === option.value}
      aria-pressed={preference === option.value}
      aria-label={compact ? option.label : undefined}
      title={compact ? option.label : undefined}
      data-theme={option.value}
      onclick={handleClick}
    >
      <Icon size={compact ? 17 : 18} strokeWidth={1.8} aria-hidden="true" />
      {#if !compact}<span>{option.label}</span>{/if}
    </button>
  {/each}
</div>
