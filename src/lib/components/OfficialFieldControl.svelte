<script lang="ts">
  import { deriveOfficialFieldValue } from "../../domain/derived-fields";
  import { isOperationalParityAutomatic } from "../../domain/operational-parity-shared";
  import {
    fieldNecessityKind,
    fieldNecessityLabel,
    isMissingRequiredField,
  } from "../field-necessity";
  import type { PageData } from "../../routes/pratiche/[id]/$types";

  type QuadroField = PageData["quadroFields"][number];
  type DeclarationIssue = PageData["declarationIssues"][number];

  let {
    data,
    field,
    occurrenceId,
    entityMissing,
    entityId: entityIdOverride = undefined,
    readOnly = false,
    readOnlyReason = "",
  } = $props<{
    data: PageData;
    field: QuadroField;
    occurrenceId: string | null;
    entityMissing: boolean;
    entityId?: string | null;
    readOnly?: boolean;
    readOnlyReason?: string;
  }>();

  function fieldEntityId(): string | null {
    if (entityIdOverride !== undefined) return entityIdOverride;
    if (field.entityScope === "decedent") return data.selectedDecedent?.id ?? null;
    if (field.entityScope === "subject") return data.selectedSubject?.id ?? null;
    if (field.entityScope === "asset") return data.selectedAsset?.id ?? null;
    return null;
  }

  function quadroEaTypeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of data.quadroSubjects) {
      const value = data.declaration.declaration.fields[
        `quadro-ea.soggetto.tipo::${entry.id}`
      ]?.value;
      if (value === null || value === undefined || value === "") continue;
      const type = String(value);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }

  function fieldValue(): string {
    if (
      isOperationalParityAutomatic(
        field.operationalParity,
        data.declaration.declaration.declarationKind,
      )
    )
      return data.automaticFieldValues[field.canonicalId] ?? "";
    if (field.entryMode === "derived")
      return (
        deriveOfficialFieldValue(field.derivedFrom, {
          declarationKind: data.declaration.declaration.declarationKind,
          quadroEaTypeCounts: quadroEaTypeCounts(),
        }) ?? ""
      );
    const entityId = fieldEntityId();
    const key = entityId
      ? `${field.canonicalId}::${entityId}`
      : occurrenceId
        ? `${field.canonicalId}::occurrence:${occurrenceId}`
        : field.canonicalId;
    const value = data.declaration.declaration.fields[key]?.value;
    return value === null || value === undefined ? "" : String(value);
  }

  function displayedFieldValue(): string {
    const value = fieldValue();
    if (value === "") return "Non applicabile";
    return field.options.find((option: { value: string }) => option.value === value)?.label ?? value;
  }

  function uncheckedValue(): string {
    return field.options.some((option: { value: string }) => option.value === "0") ? "0" : "";
  }

  function isMissingRequired(): boolean {
    const entityId = fieldEntityId();
    return data.declarationIssues.some((issue: DeclarationIssue) =>
      isMissingRequiredField(issue, field.canonicalId, entityId, occurrenceId),
    );
  }

  function necessityKind() {
    return fieldNecessityKind(field, {
      readOnly,
      automatic:
        isOperationalParityAutomatic(
          field.operationalParity,
          data.declaration.declaration.declarationKind,
        ) || field.entryMode === "derived",
      missing: isMissingRequired(),
    });
  }

  const largeOptionList = $derived(field.options.length > 80);
  const controlId = $derived(
    `field-${field.canonicalId}${fieldEntityId() ? `-${fieldEntityId()}` : ""}${occurrenceId ? `-${occurrenceId}` : ""}`,
  );
  function necessityId(): string {
    return `${controlId}-necessity`;
  }
  function missingId(): string {
    return `${controlId}-missing`;
  }
</script>

<div class="official-field" class:field-required-missing={isMissingRequired()}>
  {#if field.entryMode !== "derived" && !readOnly}<input type="hidden" name="fieldId" value={field.canonicalId} />{/if}
  <div class="official-field-heading">
    <label for={controlId}>{#if field.visibleNumber}<span>{field.visibleNumber}</span>{/if}{field.label}</label>
    <span id={necessityId()} class={`field-necessity-badge ${necessityKind()}`}>{fieldNecessityLabel(necessityKind())}</span>
  </div>
  {#if isMissingRequired()}<small id={missingId()} class="field-required-message">Dato obbligatorio mancante: compilalo per completare i controlli.</small>{/if}
  <div>
    {#if readOnly}
      <output class="official-derived-value" id={controlId} aria-describedby={necessityId()}>{fieldValue() === "" ? "Non indicato" : displayedFieldValue()}</output>
      {#if readOnlyReason}<small class="operational-field-note">{readOnlyReason}</small>{/if}
    {:else if field.entryMode === "derived"}
      <output class="official-derived-value" id={controlId} aria-describedby={necessityId()}>{displayedFieldValue()}</output>
    {:else if field.control === "checkbox"}
      <label class="official-checkbox-control" for={controlId}><input type="hidden" name={`value:${field.canonicalId}`} value={uncheckedValue()} disabled={entityMissing} /><input id={controlId} type="checkbox" name={`value:${field.canonicalId}`} value="1" checked={fieldValue() === "1"} disabled={entityMissing} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} /><span>Sì</span></label>
    {:else if largeOptionList}
      <input id={controlId} name={`value:${field.canonicalId}`} list={`options-${controlId}`} value={fieldValue()} autocomplete="off" disabled={entityMissing} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} />
      <datalist id={`options-${controlId}`}>{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</datalist>
    {:else if field.options.length > 0}
      <select id={controlId} name={`value:${field.canonicalId}`} disabled={entityMissing} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()}>
        <option value="" selected={fieldValue() === ""}>Non indicato</option>
        {#each field.options as option (option.value)}<option value={option.value} selected={fieldValue() === option.value}>{option.label}</option>{/each}
      </select>
    {:else}
      <input id={controlId} name={`value:${field.canonicalId}`} value={fieldValue()} placeholder={field.type.endsWith("DatoDT_Type") ? "GGMMAAAA" : ""} disabled={entityMissing} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} />
    {/if}
  </div>
</div>
