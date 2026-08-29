<script lang="ts">
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  import {
    isOperationalParityAutomatic,
    isOperationalParityEditable,
    isOperationalParityOfficeReserved,
  } from "../../domain/operational-parity";
  import OfficialFieldControl from "./OfficialFieldControl.svelte";

  type QuadroField = PageData["quadroFields"][number];
  type OfficialInstruction = QuadroField["instructions"][number];

  let { data, group, actionUrl, occurrenceActionUrl } = $props<{
    data: PageData;
    group: {
      key: string;
      label: string;
      fields: QuadroField[];
      occurrenceId: string | null;
      isNewOccurrence: boolean;
      occurrenceGroup: string | null;
      occurrenceIndex: number | null;
      occurrenceCount: number;
    };
    actionUrl: string;
    occurrenceActionUrl: string;
  }>();

  function fieldEntityId(field: QuadroField): string | null {
    if (field.entityScope === "decedent") return data.selectedDecedent?.id ?? null;
    if (field.entityScope === "subject") return data.selectedSubject?.id ?? null;
    if (field.entityScope === "asset") return data.selectedAsset?.id ?? null;
    return null;
  }

  function groupEntityId(): string | null {
    const firstField = group.fields[0];
    return firstField ? fieldEntityId(firstField) : null;
  }

  function entityMissing(field: QuadroField): boolean {
    return (
      (data.selectedQuadro === "EA" && !data.selectedSubject) ||
      (field.entityScope === "asset" && !data.selectedAsset) ||
      (field.entityScope === "decedent" && !data.selectedDecedent)
    );
  }

  function hasEditableFields(): boolean {
    return group.fields.some(isEditable);
  }

  function isEditable(field: QuadroField): boolean {
    return isOperationalParityEditable(
      field.operationalParity,
      data.declaration.declaration.declarationKind,
    );
  }

  function isAutomatic(field: QuadroField): boolean {
    return isOperationalParityAutomatic(
      field.operationalParity,
      data.declaration.declaration.declarationKind,
    );
  }

  function isOfficeReserved(field: QuadroField): boolean {
    return isOperationalParityOfficeReserved(
      field.operationalParity,
      data.declaration.declaration.declarationKind,
    );
  }

  function groupInstructions(): OfficialInstruction[] {
    const instructions: OfficialInstruction[] = group.fields
      .filter(isEditable)
      .flatMap((field: QuadroField) => field.instructions);
    return instructions.filter(
      (instruction: OfficialInstruction, index: number, all: OfficialInstruction[]) =>
        all.findIndex((candidate: OfficialInstruction) => candidate.id === instruction.id) === index,
    );
  }

  function saveLabel(): string {
    if (data.selectedQuadro === "EA") return "Salva questa posizione";
    if (group.occurrenceId)
      return group.isNewOccurrence ? "Aggiungi questa posizione" : "Salva questa posizione";
    if (group.fields.some((field: QuadroField) => field.entityScope === "asset"))
      return "Salva questo bene";
    if (group.label === "Dati generali") return "Salva dati generali";
    if (group.label === "Beneficiari") return "Salva beneficiari";
    if (group.label === "Dati del defunto") return "Salva dati del defunto";
    return "Salva il quadro";
  }
</script>

<section class="official-fields-group">
  <div class="official-fields-group-heading"><h3>{group.label}</h3><span>{group.fields.length} campi</span></div>
  <form method="POST" action={actionUrl}>
    <input type="hidden" name="declarationId" value={data.declaration.id} />
    <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
    <input type="hidden" name="entityId" value={groupEntityId() ?? ""} />
    <input type="hidden" name="occurrenceId" value={group.occurrenceId ?? ""} />
    <input type="hidden" name="quadro" value={data.selectedQuadro} />
    {#each group.fields as field (field.canonicalId)}
      <OfficialFieldControl
        {data}
        {field}
        occurrenceId={group.occurrenceId}
        entityMissing={entityMissing(field)}
        readOnly={!isEditable(field)}
        readOnlyReason={isAutomatic(field)
          ? "Valore prodotto automaticamente dall’elaborazione ufficiale confermata."
          : isOfficeReserved(field)
            ? "Campo riservato all’ufficio: Sequent lo conserva in sola lettura e non lo produce."
            : "Valore derivato dagli altri dati della dichiarazione."}
      />
    {/each}
    {#if hasEditableFields()}
      {#if groupInstructions().length > 0}
        <details class="official-instructions">
          <summary>Indicazioni dell’Agenzia da verificare ({groupInstructions().length})</summary>
          <ul>{#each groupInstructions() as instruction (instruction.id)}<li>{instruction.instruction}</li>{/each}</ul>
        </details>
        <label class="official-confirmation"><input type="checkbox" name="confirmOfficialRules" value="yes" required /><span>Confermo di aver verificato queste indicazioni sui dati del blocco.</span></label>
      {/if}
      <div class="official-fields-actions">
        <button class="button primary" type="submit" disabled={group.fields.some((field: QuadroField) => entityMissing(field))}>{saveLabel()}</button>
        <small>Tutti i dati di questo blocco vengono salvati insieme.</small>
      </div>
    {/if}
  </form>
  {#if group.occurrenceId && group.occurrenceGroup && !group.isNewOccurrence && group.occurrenceIndex !== null}
    <form class="official-occurrence-actions" method="POST" action={occurrenceActionUrl}>
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
      <input type="hidden" name="occurrenceGroup" value={group.occurrenceGroup} />
      <input type="hidden" name="occurrenceId" value={group.occurrenceId} />
      <input type="hidden" name="quadro" value={data.selectedQuadro} />
      <input type="hidden" name="returnSection" value="" />
      <button class="button secondary" type="submit" name="operation" value="move-up" disabled={group.occurrenceIndex === 0}>Sposta prima</button>
      <button class="button secondary" type="submit" name="operation" value="move-down" disabled={group.occurrenceIndex === group.occurrenceCount - 1}>Sposta dopo</button>
      <button class="button text" type="submit" name="operation" value="remove">Rimuovi posizione</button>
    </form>
  {/if}
</section>
