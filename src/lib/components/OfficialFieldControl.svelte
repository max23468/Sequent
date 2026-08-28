<script lang="ts">
  import { deriveOfficialFieldValue } from "../../domain/derived-fields";
  import type { PageData } from "../../routes/pratiche/[id]/$types";

  type QuadroField = PageData["quadroFields"][number];

  let { data, field, occurrenceId, entityMissing } = $props<{
    data: PageData;
    field: QuadroField;
    occurrenceId: string | null;
    entityMissing: boolean;
  }>();

  function fieldEntityId(): string | null {
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

  const largeOptionList = $derived(field.options.length > 80);
  const controlId = $derived(
    `field-${field.canonicalId}${occurrenceId ? `-${occurrenceId}` : ""}`,
  );
</script>

<div class="official-field">
  {#if field.entryMode !== "derived"}<input type="hidden" name="fieldId" value={field.canonicalId} />{/if}
  <label for={controlId}>{#if field.visibleNumber}<span>{field.visibleNumber}</span>{/if}{field.label}</label>
  <div>
    {#if field.entryMode === "derived"}
      <output class="official-derived-value" id={controlId}>{displayedFieldValue()}</output>
    {:else if field.control === "checkbox"}
      <div class="official-checkbox-control"><input type="hidden" name={`value:${field.canonicalId}`} value={uncheckedValue()} disabled={entityMissing} /><input id={controlId} type="checkbox" name={`value:${field.canonicalId}`} value="1" checked={fieldValue() === "1"} disabled={entityMissing} /><span>Sì</span></div>
    {:else if largeOptionList}
      <input id={controlId} name={`value:${field.canonicalId}`} list={`options-${controlId}`} value={fieldValue()} autocomplete="off" disabled={entityMissing} />
      <datalist id={`options-${controlId}`}>{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</datalist>
    {:else if field.options.length > 0}
      <select id={controlId} name={`value:${field.canonicalId}`} disabled={entityMissing}>
        <option value="" selected={fieldValue() === ""}>Non indicato</option>
        {#each field.options as option (option.value)}<option value={option.value} selected={fieldValue() === option.value}>{option.label}</option>{/each}
      </select>
    {:else}
      <input id={controlId} name={`value:${field.canonicalId}`} value={fieldValue()} placeholder={field.type.endsWith("DatoDT_Type") ? "GGMMAAAA" : ""} disabled={entityMissing} />
    {/if}
  </div>
</div>
