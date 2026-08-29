<script lang="ts">
  import { tick } from "svelte";
  import { CheckCircle2, ChevronDown, FileText, History, Pencil, Upload } from "@lucide/svelte";
  import RenamePracticeDialog from "$lib/components/RenamePracticeDialog.svelte";
  import { formatItalianDate } from "$lib/format";

  type DeclarationOption = {
    id: string;
    sequence: number;
    declaration: { declarationKind: string };
  };

  let {
    practice,
    declarations,
    selectedDeclarationId,
    viewMode,
    renameActionUrl,
    renameError,
    onSelectOperationalView,
    onSelectQuadriView,
    onSelectDeclaration,
    onChooseWorkspaceFile,
  } = $props<{
    practice: { id: string; title: string; updatedAt: string };
    declarations: DeclarationOption[];
    selectedDeclarationId: string;
    viewMode: "operational" | "quadri";
    renameActionUrl: string;
    renameError?: string;
    onSelectOperationalView: () => void | Promise<void>;
    onSelectQuadriView: () => void | Promise<void>;
    onSelectDeclaration: (event: Event) => void | Promise<void>;
    onChooseWorkspaceFile: () => void | Promise<void>;
  }>();

  let actionsMenu = $state<HTMLDetailsElement>();
  // oxlint-disable-next-line no-unassigned-vars -- Svelte assegna il componente tramite bind:this.
  let renameDialog: { show: () => void };

  async function chooseWorkspaceFile() {
    actionsMenu?.removeAttribute("open");
    await onChooseWorkspaceFile();
    await tick();
  }

  function openRenameDialog() {
    actionsMenu?.removeAttribute("open");
    renameDialog?.show();
  }

  function dismissActions(event: PointerEvent | KeyboardEvent) {
    if (!actionsMenu?.open) return;
    if (event.type === "pointerdown" && actionsMenu.contains(event.target as Node)) return;
    if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
    actionsMenu.open = false;
    if (event.type === "keydown") actionsMenu.querySelector<HTMLElement>("summary")?.focus();
  }
</script>

<svelte:window onpointerdown={dismissActions} onkeydown={dismissActions} />

<div class="practice-heading">
  <div class="practice-heading-copy">
    <p class="breadcrumbs"><a href="/pratiche" data-sveltekit-prefetch>Pratiche</a><span>/</span><span title={practice.title}>{practice.title}</span></p>
    <div class="practice-title-line"><h1 title={practice.title}>{practice.title}</h1></div>
    <div class="practice-meta-row"><span>Aggiornata il {formatItalianDate(practice.updatedAt)}</span><span class="saved-state"><CheckCircle2 size={18} />Salvato</span></div>
  </div>
  <div class="practice-heading-actions">
    <div class="practice-view-switch" aria-label="Organizzazione della pratica">
      <button type="button" class:active={viewMode === "operational"} aria-pressed={viewMode === "operational"} onclick={onSelectOperationalView}>Vista operativa</button>
      <button type="button" class:active={viewMode === "quadri"} aria-pressed={viewMode === "quadri"} onclick={onSelectQuadriView}>Vista Quadri</button>
    </div>
    <label class="practice-declaration-selector">
      <span>Dichiarazione</span>
      <select aria-label="Dichiarazione selezionata" onchange={onSelectDeclaration}>
        {#each declarations as declaration (declaration.id)}
          <option value={declaration.id} selected={declaration.id === selectedDeclarationId}>{declaration.sequence} · {declaration.declaration.declarationKind === "first" ? "Prima" : `Sostitutiva ${declaration.declaration.declarationKind.at(-1)}`}</option>
        {/each}
      </select>
    </label>
    <details class="workspace-actions-menu" bind:this={actionsMenu}>
      <summary class="button secondary">Azioni <ChevronDown size={17} /></summary>
      <div class="workspace-actions-popover"><button type="button" onclick={openRenameDialog}><Pencil size={17} />Rinomina pratica</button><button type="button" onclick={chooseWorkspaceFile}><Upload size={17} />Carica documento</button><a href={`?sezione=history&vista=operational&dichiarazione=${selectedDeclarationId}`}><History size={17} />Apri la cronologia</a><a href={`/pratiche/${practice.id}/riepilogo`} target="_blank"><FileText size={17} />Apri il riepilogo</a></div>
    </details>
  </div>
</div>

<RenamePracticeDialog
  bind:this={renameDialog}
  actionUrl={renameActionUrl}
  title={practice.title}
  error={renameError}
/>
