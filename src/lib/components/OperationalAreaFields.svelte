<script lang="ts">
  import { FileText } from "@lucide/svelte";
  import type { PageData } from "../../routes/pratiche/[id]/$types";
  import OperationalFieldGroup from "./OperationalFieldGroup.svelte";

  type OperationalField = PageData["operationalFields"][number];
  interface FieldGroup {
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
  }

  let { data, actionUrl, occurrenceActionUrl, returnSection } = $props<{
    data: PageData;
    actionUrl: string;
    occurrenceActionUrl: string;
    returnSection: string;
  }>();

  function applicableFields(): OperationalField[] {
    const kind = data.declaration.declaration.declarationKind;
    return data.operationalFields.filter(
      (field: OperationalField) =>
        field.appliesToDeclarationKinds.length === 0 ||
        field.appliesToDeclarationKinds.includes(kind),
    );
  }

  function baseGroups(): Array<Omit<FieldGroup, "label" | "entityId" | "entityMissing" | "occurrenceId" | "isNewOccurrence" | "initiallyOpen" | "anchorId" | "occurrenceGroup" | "occurrenceIndex" | "occurrenceCount">> {
    const groups = new Map<
      string,
      Omit<FieldGroup, "label" | "entityId" | "entityMissing" | "occurrenceId" | "isNewOccurrence" | "initiallyOpen" | "anchorId" | "occurrenceGroup" | "occurrenceIndex" | "occurrenceCount">
    >();
    for (const field of applicableFields()) {
      const parity = field.operationalParity;
      const scope = field.entityScope ?? "declaration";
      const key = `${parity.candidateContext}:${parity.quadro}:${scope}:${field.occurrenceGroup ?? "single"}`;
      const group = groups.get(key) ?? {
        key,
        context: parity.candidateContext,
        quadro: parity.quadro,
        fields: [],
      };
      group.fields.push(field);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  function fieldGroups(): FieldGroup[] {
    const expanded = baseGroups().flatMap((group): FieldGroup[] => {
      const scope = group.fields[0]?.entityScope ?? "declaration";
      if (scope === "subject") {
        const entries = group.quadro === "EA" ? data.quadroSubjects : [];
        if (entries.length === 0) return [];
        return entries.map((entry: PageData["quadroSubjects"][number]) => ({
          ...group,
          key: `${group.key}:${entry.id}`,
          label: `${entry.displayName}${entry.occurrence > 1 ? ` · posizione ${entry.occurrence}` : ""}`,
          entityId: entry.id,
          entityMissing: false,
          occurrenceId: null,
          isNewOccurrence: false,
          initiallyOpen: false,
          anchorId: null,
          occurrenceGroup: null,
          occurrenceIndex: null,
          occurrenceCount: 0,
        }));
      }
      if (scope === "asset") {
        const assets = data.assets.filter(
          (asset: PageData["assets"][number]) => asset.quadro === group.quadro,
        );
        if (assets.length === 0) return [];
        return assets.map((asset: PageData["assets"][number]) => ({
          ...group,
          key: `${group.key}:${asset.id}`,
          label: asset.displayName,
          entityId: asset.id,
          entityMissing: false,
          occurrenceId: null,
          isNewOccurrence: false,
          initiallyOpen: false,
          anchorId: null,
          occurrenceGroup: null,
          occurrenceIndex: null,
          occurrenceCount: 0,
        }));
      }
      if (scope === "decedent" && !data.selectedDecedent) return [];
      if (scope === "decedent")
        return [{
          ...group,
          label: data.selectedDecedent!.displayName,
          entityId: data.selectedDecedent!.id,
          entityMissing: false,
          occurrenceId: null,
          isNewOccurrence: false,
          initiallyOpen: false,
          anchorId: null,
          occurrenceGroup: null,
          occurrenceIndex: null,
          occurrenceCount: 0,
        }];
      if (scope === "occurrence") {
        const occurrenceGroup = group.fields[0]?.occurrenceGroup ?? null;
        const occurrenceIds = (data.occurrenceOrders[occurrenceGroup ?? ""] ?? []) as string[];
        const existing = occurrenceIds.map((occurrenceId, index) => ({
          ...group,
          key: `${group.key}:${occurrenceId}`,
          label: `${group.context} · posizione ${index + 1}`,
          entityId: null,
          entityMissing: false,
          occurrenceId,
          isNewOccurrence: false,
          initiallyOpen: false,
          anchorId: null,
          occurrenceGroup,
          occurrenceIndex: index,
          occurrenceCount: occurrenceIds.length,
        }));
        const newOccurrenceId = occurrenceGroup
          ? (data.newOccurrenceIds[occurrenceGroup] ?? null)
          : null;
        return [
          ...existing,
          {
            ...group,
            key: `${group.key}:new`,
            label: `${group.context} · nuova posizione`,
            entityId: null,
            entityMissing: newOccurrenceId === null,
            occurrenceId: newOccurrenceId,
            isNewOccurrence: true,
            initiallyOpen: false,
            anchorId: null,
            occurrenceGroup: occurrenceGroup ?? null,
            occurrenceIndex: null,
            occurrenceCount: occurrenceIds.length,
          },
        ];
      }
      return [{
        ...group,
        label: group.context,
        entityId: null,
        entityMissing: false,
        occurrenceId: null,
        isNewOccurrence: false,
        initiallyOpen: false,
        anchorId: null,
        occurrenceGroup: null,
        occurrenceIndex: null,
        occurrenceCount: 0,
      }];
    });
    const anchoredEntities = new Set<string>();
    return expanded.map((group, index) => {
      const anchorId =
        group.entityId && !anchoredEntities.has(group.entityId)
          ? `operational-entity-${group.entityId}`
          : null;
      if (group.entityId) anchoredEntities.add(group.entityId);
      return { ...group, initiallyOpen: index === 0, anchorId };
    });
  }

  function visibleFieldCount(): number {
    return fieldGroups().reduce((total, group) => total + group.fields.length, 0);
  }

  function areaDescription(): string {
    if (returnSection === "checklist")
      return "Qui compili i riferimenti del Quadro EG. I file caricati e il loro stato di acquisizione restano gestiti sopra.";
    if (returnSection === "assets")
      return "Sono mostrati solo i Quadri pertinenti ai beni e alle passività già registrati.";
    return "Organizzati per oggetto professionale, con la stessa fonte canonica della Vista Quadri.";
  }
</script>

{#if data.operationalFields.length === 0}
  <div class="panel-empty workspace-empty"><FileText size={27} /><p>Nessun campo ufficiale in questa area.</p><span>Le funzioni trasversali restano disponibili senza duplicare i dati dei Quadri.</span></div>
{:else}
  <section class="operational-canonical-fields" aria-labelledby={`operational-fields-${returnSection}`}>
    <div class="operational-canonical-heading">
      <div><h2 id={`operational-fields-${returnSection}`}>Dati della dichiarazione</h2><p>{areaDescription()}</p></div>
      <span>{visibleFieldCount()} campi pertinenti</span>
    </div>
    <div class="official-fields">
      {#each fieldGroups() as group (group.key)}
        <OperationalFieldGroup {data} {group} {actionUrl} {occurrenceActionUrl} {returnSection} />
      {/each}
    </div>
  </section>
{/if}
