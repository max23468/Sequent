<script lang="ts">
  import { page } from "$app/state";
  import { FileText } from "@lucide/svelte";
  import type { ActionData, PageData } from "../../routes/pratiche/[id]/$types";
  import OfficialFieldGroup from "./OfficialFieldGroup.svelte";

  type QuadroField = PageData["quadroFields"][number];
  interface FieldGroup {
    key: string;
    label: string;
    fields: QuadroField[];
  }

  let { data, form, actionUrl, duplicateActionUrl } = $props<{
    data: PageData;
    form: ActionData | null;
    actionUrl: string;
    duplicateActionUrl: string;
  }>();

  function subjectHref(subjectId: string): string {
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", "quadri");
    search.set("vista", "quadri");
    search.set("quadro", "EA");
    search.set("soggetto", subjectId);
    return `${page.url.pathname}?${search.toString()}`;
  }

  function assetHref(assetId: string): string {
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", "quadri");
    search.set("vista", "quadri");
    search.set("quadro", data.selectedQuadro);
    search.set("bene", assetId);
    return `${page.url.pathname}?${search.toString()}`;
  }

  function hasRepeatedPositions(subjectId: string): boolean {
    let count = 0;
    for (const entry of data.quadroSubjects) {
      if (entry.subjectId === subjectId) count += 1;
    }
    return count > 1;
  }

  function fieldsForCurrentDeclaration(): QuadroField[] {
    const kind = data.declaration.declaration.declarationKind;
    return data.quadroFields.filter(
      (field: QuadroField) =>
        field.appliesToDeclarationKinds.length === 0 ||
        field.appliesToDeclarationKinds.includes(kind),
    );
  }

  function fieldGroups(): FieldGroup[] {
    if (data.selectedQuadro === "EA")
      return [
        {
          key: "dati-del-soggetto:subject",
          label: "Dati del soggetto",
          fields: fieldsForCurrentDeclaration(),
        },
      ];
    const groups = new Map<string, FieldGroup>();
    for (const field of fieldsForCurrentDeclaration()) {
      const label = field.saveGroup ?? field.section ?? (data.selectedQuadro === "EA" ? "Dati del soggetto" : `Quadro ${data.selectedQuadro}`);
      const key = `${label}:${field.entityScope ?? "declaration"}`;
      const group = groups.get(key) ?? { key, label, fields: [] };
      group.fields.push(field);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

</script>

<div class="workspace-panel-heading"><h2>{data.selectedQuadro === "Frontespizio" ? "Frontespizio" : `Quadro ${data.selectedQuadro}`}</h2><span>{fieldsForCurrentDeclaration().length} campi disponibili</span></div>

{#if data.selectedQuadro === "EA"}
  <div class="quadro-subject-selector">
    <span>Soggetto del Quadro EA</span>
    {#if data.quadroSubjects.length === 0}
      <p>Aggiungi almeno un beneficiario o un altro soggetto prima di compilare questo quadro.</p>
    {:else}
      <nav aria-label="Soggetti del Quadro EA">
        {#each data.quadroSubjects as subject (subject.id)}
          <a class:active={data.selectedSubject?.id === subject.id} aria-current={data.selectedSubject?.id === subject.id ? "page" : undefined} href={subjectHref(subject.id)}>{subject.displayName}{hasRepeatedPositions(subject.subjectId) ? ` · posizione ${subject.occurrence}` : ""}</a>
        {/each}
      </nav>
      {#if data.selectedSubject}
        <form class="duplicate-subject-entry" method="POST" action={duplicateActionUrl}>
          <input type="hidden" name="declarationId" value={data.declaration.id} />
          <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
          <input type="hidden" name="sourceEntryId" value={data.selectedSubject.id} />
          <button class="button secondary" type="submit">Aggiungi un’altra posizione per questo soggetto</button>
          <small>I dati attuali vengono ripresi e possono poi essere modificati nella nuova posizione.</small>
        </form>
      {/if}
    {/if}
  </div>
{:else if data.quadroFields.some((field: QuadroField) => field.entityScope === "asset")}
  <div class="quadro-subject-selector">
    <span>Bene o passività del quadro</span>
    {#if data.quadroAssets.length === 0}
      <p>Aggiungi prima un elemento del tipo previsto nella vista operativa.</p>
    {:else}
      <nav aria-label="Beni e passività del quadro">
        {#each data.quadroAssets as asset (asset.id)}
          <a class:active={data.selectedAsset?.id === asset.id} aria-current={data.selectedAsset?.id === asset.id ? "page" : undefined} href={assetHref(asset.id)}>{asset.displayName}</a>
        {/each}
      </nav>
    {/if}
  </div>
{:else if data.selectedQuadro === "Frontespizio"}
  <div class="quadro-subject-selector">
    <span>Dati del defunto</span>
    {#if data.selectedDecedent}
      <strong>{data.selectedDecedent.displayName}</strong>
      <p>Questi dati appartengono al procedimento e vengono ripresi nelle dichiarazioni successive.</p>
    {:else}
      <p>Aggiungi prima il defunto nella vista operativa per compilare questa parte del Frontespizio.</p>
    {/if}
  </div>
{/if}

{#if data.quadroFields.length === 0}
  <div class="panel-empty workspace-empty"><FileText size={27} /><p>Questo quadro non è ancora compilabile.</p><span>Etichette e corrispondenze con il modello ministeriale devono essere verificate prima di mostrare i campi.</span></div>
{:else}
  <div class="official-fields">
    {#each fieldGroups() as group (group.key)}
      <OfficialFieldGroup {data} {group} {actionUrl} />
    {/each}
  </div>
{/if}

{#if form?.fieldError}<p class="workspace-form-error" role="alert">{form.fieldError}</p>{/if}
{#if form?.duplicateError}<p class="workspace-form-error" role="alert">{form.duplicateError}</p>{/if}
