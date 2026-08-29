<script lang="ts">
  import { ChevronDown, FileText } from "@lucide/svelte";
  import { practiceSections } from "$lib/practice-workspace";

  type QuadroNavigationItem = {
    id: string;
    verifiedFieldCount: number;
    userFieldCount: number;
  };

  let {
    viewMode,
    selectedSection,
    selectedQuadro,
    quadri,
    reviewCount,
    mobileNavigationOpen = $bindable(false),
    onSelectSection,
    onSelectQuadro,
  } = $props<{
    viewMode: "operational" | "quadri";
    selectedSection: string;
    selectedQuadro: string;
    quadri: QuadroNavigationItem[];
    reviewCount: number;
    mobileNavigationOpen?: boolean;
    onSelectSection: (event: MouseEvent) => void | Promise<void>;
    onSelectQuadro: (event: MouseEvent) => void | Promise<void>;
  }>();

  let currentLabel = $derived(
    viewMode === "quadri"
      ? selectedQuadro === "Frontespizio"
        ? "Frontespizio"
        : `Quadro ${selectedQuadro}`
      : (practiceSections.find((section) => section.id === selectedSection)?.label ?? "Panoramica"),
  );

  function toggleNavigation() {
    mobileNavigationOpen = !mobileNavigationOpen;
  }

  async function selectSection(event: MouseEvent) {
    mobileNavigationOpen = false;
    await onSelectSection(event);
  }

  async function selectQuadro(event: MouseEvent) {
    mobileNavigationOpen = false;
    await onSelectQuadro(event);
  }
</script>

<aside class="workspace-sections">
  <div class="workspace-panel-heading"><h2>{viewMode === "quadri" ? "Quadri" : "Sezioni"}</h2></div>
  <button
    type="button"
    class="workspace-sections-toggle"
    aria-label={`Apri il menu ${viewMode === "quadri" ? "Quadri" : "Sezioni"}: ${currentLabel}`}
    aria-expanded={mobileNavigationOpen}
    aria-controls="workspace-sections-navigation"
    onclick={toggleNavigation}
  >
    <span><small>{viewMode === "quadri" ? "Quadro" : "Sezione"}</small><strong>{currentLabel}</strong></span>
    <ChevronDown size={19} />
  </button>
  {#if viewMode === "operational"}
    <nav id="workspace-sections-navigation" class:mobile-open={mobileNavigationOpen} aria-label="Sezioni pratica">
      {#each practiceSections as section (section.id)}
        {#if section.id !== "verifications" || reviewCount > 0}
          {@const Icon = section.icon}
          <button type="button" class:active={selectedSection === section.id} data-section={section.id} aria-pressed={selectedSection === section.id} onclick={selectSection}>
            <Icon size={19} /><span>{section.label}</span>
            {#if section.id === "verifications"}<small>{reviewCount}</small>{/if}
          </button>
        {/if}
      {/each}
    </nav>
  {:else}
    <nav id="workspace-sections-navigation" class:mobile-open={mobileNavigationOpen} aria-label="Quadri della dichiarazione" class="quadri-navigation">
      {#each quadri as quadro (quadro.id)}
        <button type="button" class:active={selectedQuadro === quadro.id} data-quadro={quadro.id} aria-pressed={selectedQuadro === quadro.id} aria-label={`${quadro.id === "Frontespizio" ? "Frontespizio" : `Quadro ${quadro.id}`}: ${quadro.verifiedFieldCount} etichette verificate su ${quadro.userFieldCount} campi compilabili`} title={`${quadro.verifiedFieldCount} etichette verificate su ${quadro.userFieldCount} campi compilabili`} onclick={selectQuadro}>
          <FileText size={18} /><span>{quadro.id === "Frontespizio" ? "Frontespizio" : `Quadro ${quadro.id}`}</span><small>{quadro.verifiedFieldCount}/{quadro.userFieldCount}</small>
        </button>
      {/each}
    </nav>
  {/if}
</aside>
