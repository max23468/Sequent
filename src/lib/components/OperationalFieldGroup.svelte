<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  import {
    isOperationalParityEditable,
    operationalParityHandlingForDeclaration,
  } from "../../domain/operational-parity-shared";
  import {
    fieldRequirementSummary,
    isConditionallyApplicableGroup,
  } from "../field-necessity";
  import OfficialFieldControl from "./OfficialFieldControl.svelte";

  type OperationalField = PageData["operationalFields"][number];
  type OfficialInstruction = OperationalField["instructions"][number];

  let { data, group, actionUrl, occurrenceActionUrl, returnSection } = $props<{
    data: PageData;
    group: {
      key: string;
      label: string;
      context: string;
      quadro: string;
      fields: OperationalField[];
      entityId: string | null;
      entityMissing: boolean;
      occurrenceId: string | null;
      isNewOccurrence: boolean;
      initiallyOpen: boolean;
      anchorId: string | null;
      occurrenceGroup: string | null;
      occurrenceIndex: number | null;
      occurrenceCount: number;
    };
    actionUrl: string;
    occurrenceActionUrl: string;
    returnSection: string;
  }>();
  function isEditable(field: OperationalField): boolean {
    return isOperationalParityEditable(
      field.operationalParity,
      data.declaration.declaration.declarationKind,
    );
  }

  function readOnlyReason(field: OperationalField): string {
    const review = field.operationalParity.semanticReview;
    if (review.status === "irrisolta") return review.blocker ?? review.reason;
    if (review.status === "candidata")
      return "Consultabile qui; la modalità di compilazione è ancora da qualificare sulle fonti ufficiali.";
    if (
      operationalParityHandlingForDeclaration(
        field.operationalParity,
        data.declaration.declaration.declarationKind,
      ) === "gestito-automaticamente"
    )
      return "Valore gestito automaticamente dalle regole ufficiali.";
    if (field.operationalParity.handling === "derivato")
      return "Valore derivato dagli altri dati della dichiarazione.";
    if (field.operationalParity.handling === "riservato-ufficio")
      return "Campo riservato all’ufficio: Sequent lo conserva in sola lettura e non lo produce.";
    return "Valore disponibile in sola lettura.";
  }

  function editableFields(): OperationalField[] {
    return group.fields.filter(isEditable);
  }

  function groupInstructions(): OfficialInstruction[] {
    const instructions = editableFields().flatMap((field) => field.instructions);
    return instructions.filter(
      (instruction, index, all) =>
        all.findIndex((candidate) => candidate.id === instruction.id) === index,
    );
  }

  function saveLabel(): string {
    if (group.occurrenceId)
      return group.isNewOccurrence ? "Aggiungi questa posizione" : "Salva questa posizione";
    if (group.entityId) return "Salva questa scheda";
    return "Salva questi dati";
  }

  function groupRequirementSummary(): string {
    return isConditionallyApplicableGroup(group.fields)
      ? "Blocco solo se pertinente"
      : fieldRequirementSummary(group.fields);
  }
</script>

<details
  id={group.anchorId ?? undefined}
  class="official-fields-group operational-fields-group"
  open={group.initiallyOpen}
>
  <summary class="operational-fields-summary">
    <span><strong>{group.label}</strong><small>{group.context}</small></span>
    <span class="field-group-summary-meta"><span class="operational-fields-meta">{group.quadro === "Frontespizio" ? "Frontespizio" : `Quadro ${group.quadro}`} · {group.fields.length} campi<br />{groupRequirementSummary()}</span><ChevronDown class="field-group-chevron" size={16} aria-hidden="true" /></span>
  </summary>
  {#if group.entityMissing}
    <p class="qualification-notice" role="status">Crea prima l’oggetto professionale richiesto per compilare questo blocco.</p>
  {/if}
  <form method="POST" action={actionUrl}>
    <input type="hidden" name="declarationId" value={data.declaration.id} />
    <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
    <input type="hidden" name="entityId" value={group.entityId ?? ""} />
    <input type="hidden" name="occurrenceId" value={group.occurrenceId ?? ""} />
    <input type="hidden" name="quadro" value={group.quadro} />
    <input type="hidden" name="returnSection" value={returnSection} />
    {#each group.fields as field (field.canonicalId)}
      <OfficialFieldControl
        {data}
        {field}
        occurrenceId={group.occurrenceId}
        entityId={group.entityId}
        entityMissing={group.entityMissing}
        readOnly={!isEditable(field)}
        readOnlyReason={readOnlyReason(field)}
      />
    {/each}
    {#if editableFields().length > 0}
      {#if groupInstructions().length > 0}
        <details class="official-instructions">
          <summary>Indicazioni dell’Agenzia da verificare ({groupInstructions().length})</summary>
          <ul>{#each groupInstructions() as instruction (instruction.id)}<li>{instruction.instruction}</li>{/each}</ul>
        </details>
      {/if}
      <div class="official-fields-actions">
        <button class="button primary" type="submit" disabled={group.entityMissing}>{saveLabel()}</button>
        <small>Il salvataggio aggiorna gli stessi campi canonici della Vista Quadri.</small>
      </div>
    {/if}
  </form>
  {#if group.occurrenceId && group.occurrenceGroup && !group.isNewOccurrence && group.occurrenceIndex !== null}
    <form class="official-occurrence-actions" method="POST" action={occurrenceActionUrl}>
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
      <input type="hidden" name="occurrenceGroup" value={group.occurrenceGroup} />
      <input type="hidden" name="occurrenceId" value={group.occurrenceId} />
      <input type="hidden" name="quadro" value={group.quadro} />
      <input type="hidden" name="returnSection" value={returnSection} />
      <button class="button secondary" type="submit" name="operation" value="move-up" disabled={group.occurrenceIndex === 0}>Sposta prima</button>
      <button class="button secondary" type="submit" name="operation" value="move-down" disabled={group.occurrenceIndex === group.occurrenceCount - 1}>Sposta dopo</button>
      <button class="button text" type="submit" name="operation" value="remove">Rimuovi posizione</button>
    </form>
  {/if}
</details>
