<script lang="ts">
  import { deriveOfficialFieldValue } from "../../domain/derived-fields";
  import { isOperationalParityAutomatic } from "../../domain/operational-parity-shared";
  import {
    fieldNecessityKind,
    fieldNecessityLabel,
    isMissingRequiredField,
  } from "../field-necessity";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  import OfficialSearchSelect from "./OfficialSearchSelect.svelte";
  import { getContext } from "svelte";
  import {
    SUCCESSIONIONLINE_FIELD_STATE,
    type SuccessioniOnLineFieldState,
  } from "../successionionline-field-state";

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

  const liveFieldState =
    getContext<SuccessioniOnLineFieldState | undefined>(SUCCESSIONIONLINE_FIELD_STATE) ?? {
      current: (_fieldId: string, persistedValue: string) => persistedValue,
      update: () => undefined,
    };

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
    if (field.successioniOnLineAttachmentBucket) {
      const bucket = data.officialEgAttachments.buckets.find(
        (candidate: { id: string }) => candidate.id === field.successioniOnLineAttachmentBucket?.id,
      );
      return bucket && bucket.count > 0 ? String(bucket.count) : "";
    }
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

  function relatedFieldValue(fieldId: string | null): string {
    if (!fieldId) return "";
    const entityId = fieldEntityId();
    const key = entityId
      ? `${fieldId}::${entityId}`
      : occurrenceId
        ? `${fieldId}::occurrence:${occurrenceId}`
        : fieldId;
    const value = data.declaration.declaration.fields[key]?.value;
    const persisted = value === null || value === undefined ? "" : String(value);
    return liveFieldState.current(fieldId, persisted);
  }

  function updateLiveValue(event: Event): void {
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    if (control instanceof HTMLInputElement && control.type === "radio") {
      if (!control.checked) return;
      for (const radio of document.getElementsByName(control.name))
        if (radio instanceof HTMLInputElement)
          liveFieldState.update(radio.value, radio.checked ? "1" : "0");
      return;
    }
    liveFieldState.update(
      field.canonicalId,
      control instanceof HTMLInputElement && control.type === "checkbox"
        ? control.checked
          ? "1"
          : uncheckedValue()
        : control.value,
    );
  }

  function updateRadioPanelValue(event: Event): void {
    const control = event.currentTarget as HTMLInputElement;
    if (control.checked) liveFieldState.update(field.canonicalId, control.value);
  }

  function displayedFieldValue(): string {
    const value = fieldValue();
    if (value === "") return "Non applicabile";
    return field.options.find((option: { value: string }) => option.value === value)?.label ?? value;
  }

  function uncheckedValue(): string {
    return field.options.some((option: { value: string }) => option.value === "0") ? "0" : "";
  }

  function disabledBySuccessioniOnLine(): boolean {
    return (field.successioniOnLineDisabledWhen ?? []).some(
      (condition: { fieldId: string; value: string }) =>
        relatedFieldValue(condition.fieldId) === condition.value,
    );
  }

  function controlDisabled(): boolean {
    return entityMissing || disabledBySuccessioniOnLine();
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
        ) || field.entryMode === "derived" || Boolean(field.successioniOnLineAttachmentBucket),
      missing: isMissingRequired(),
    });
  }

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
  {#if field.entryMode !== "derived" && !readOnly && !field.successioniOnLineAttachmentBucket}<input type="hidden" name="fieldId" value={field.canonicalId} />{/if}
  <div class="official-field-heading">
    <label id={`${controlId}-label`} for={field.successioniOnLineRadioPanel ? undefined : controlId}>{#if field.visibleNumber}<span>{field.visibleNumber}</span>{/if}{field.label}</label>
    <span id={necessityId()} class={`field-necessity-badge ${necessityKind()}`}>{fieldNecessityLabel(necessityKind())}</span>
  </div>
  {#if isMissingRequired()}<small id={missingId()} class="field-required-message">Dato obbligatorio mancante: compilalo per completare i controlli.</small>{/if}
  <div>
    {#if disabledBySuccessioniOnLine()}<small class="operational-field-note">Campo disabilitato dalla scelta collegata, come in SuccessioniOnLine.</small>{/if}
    {#if field.successioniOnLineAttachmentBucket}
      {@const bucket = data.officialEgAttachments.buckets.find((candidate: { id: string }) => candidate.id === field.successioniOnLineAttachmentBucket?.id)}
      <output class="official-derived-value" id={controlId} aria-describedby={necessityId()}>{fieldValue() === "" ? "Nessun allegato" : `${fieldValue()} allegat${fieldValue() === "1" ? "o" : "i"}`}</output>
      <small class="operational-field-note">{field.successioniOnLineAttachmentBucket.id} · conteggio prodotto dai documenti preparati{bucket?.preparedFileNames.length ? `: ${bucket.preparedFileNames.join(", ")}` : "."}</small>
    {:else if readOnly}
      <output class="official-derived-value" id={controlId} aria-describedby={necessityId()}>{fieldValue() === "" ? "Non indicato" : displayedFieldValue()}</output>
      {#if readOnlyReason}<small class="operational-field-note">{readOnlyReason}</small>{/if}
    {:else if field.entryMode === "derived"}
      <output class="official-derived-value" id={controlId} aria-describedby={necessityId()}>{displayedFieldValue()}</output>
    {:else if field.successioniOnLineRadioGroup}
      <label class="official-radio-control" for={controlId}><input id={controlId} type="radio" name={`successioniOnLineRadio:${field.successioniOnLineRadioGroup}`} value={field.canonicalId} checked={fieldValue() === "1"} disabled={controlDisabled()} onchange={updateLiveValue} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} /><span>Seleziona</span></label>
    {:else if field.successioniOnLineRadioPanel}
      <div class="official-radio-panel" role="radiogroup" aria-labelledby={`${controlId}-label`} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()}>
        {#each field.options as option (option.value)}
          <label class="official-radio-control" for={`${controlId}-${option.value}`}><input id={`${controlId}-${option.value}`} type="radio" name={`value:${field.canonicalId}`} value={option.value} checked={fieldValue() === option.value} disabled={controlDisabled()} onchange={updateRadioPanelValue} /><span>{option.label}</span></label>
        {/each}
      </div>
    {:else if field.control === "checkbox"}
      <label class="official-checkbox-control" for={controlId}><input type="hidden" name={`value:${field.canonicalId}`} value={uncheckedValue()} disabled={controlDisabled()} /><input id={controlId} type="checkbox" name={`value:${field.canonicalId}`} value="1" checked={fieldValue() === "1"} disabled={controlDisabled()} onchange={updateLiveValue} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} /><span>Sì</span></label>
    {:else if field.control === "combobox"}
      <OfficialSearchSelect
        id={controlId}
        fieldId={field.canonicalId}
        name={`value:${field.canonicalId}`}
        value={fieldValue()}
        provinceFieldId={field.choiceProvinceFieldId}
        provinceValue={relatedFieldValue(field.choiceProvinceFieldId)}
        disabled={controlDisabled()}
        ariaLabel={`${field.visibleNumber ? `${field.visibleNumber} ` : ""}${field.label}`}
        ariaDescribedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()}
      />
    {:else if field.control === "select" || field.options.length > 0}
      <select id={controlId} name={`value:${field.canonicalId}`} disabled={controlDisabled()} onchange={updateLiveValue} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()}>
        <option value="" selected={fieldValue() === ""}>Non indicato</option>
        {#each field.options as option (option.value)}<option value={option.value} selected={fieldValue() === option.value}>{option.label}</option>{/each}
      </select>
    {:else}
      <input id={controlId} name={`value:${field.canonicalId}`} value={fieldValue()} placeholder={field.type.endsWith("DatoDT_Type") ? "GGMMAAAA" : ""} disabled={controlDisabled()} onchange={updateLiveValue} aria-describedby={isMissingRequired() ? `${necessityId()} ${missingId()}` : necessityId()} />
    {/if}
  </div>
</div>
