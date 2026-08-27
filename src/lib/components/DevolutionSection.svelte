<script lang="ts">
  import { Scale } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";
  import type { ActionData, PageData } from "../../routes/pratiche/[id]/$types";
  import DevolutionAsset from "./DevolutionAsset.svelte";

  let { data, form, saveAction, confirmAction, assetKindLabels } = $props<{
    data: PageData;
    form: ActionData | null;
    saveAction: string;
    confirmAction: string;
    assetKindLabels: Record<string, string>;
  }>();

  const latestScenario = $derived(data.devolutionScenarios.at(0) ?? null);
  const hasActiveAssets = $derived(
    data.assets.some((asset: { kind: string }) => asset.kind !== "donation"),
  );
  const hasBeneficiaries = $derived(
    data.subjects.some((subject: { role: string }) => subject.role !== "decedent"),
  );
</script>

<div class="workspace-panel-heading"><h2>Devoluzione</h2><span>{data.declaration.declaration.confirmedDevolutionScenarioId ? "Confermata" : "Conferma richiesta"}</span></div>
{#if !hasActiveAssets || !hasBeneficiaries}
  <div class="panel-empty workspace-empty"><Scale size={27} /><p>Aggiungi almeno un bene e un beneficiario.</p><span>La ripartizione viene preparata quando sono disponibili entrambi.</span></div>
{:else}
  <form class="devolution-form" method="POST" action={saveAction}>
    <input type="hidden" name="declarationId" value={data.declaration.id} />
    <input type="hidden" name="expectedRevision" value={data.declaration.revision} />
    {#each data.assets as asset (asset.id)}
      {#if asset.kind !== "donation"}<DevolutionAsset {data} {asset} scenario={latestScenario} kindLabel={assetKindLabels[asset.kind]} />{/if}
    {/each}
    <div class="official-fields-actions"><button class="button primary" type="submit">Salva proposta di devoluzione</button><small>Il salvataggio non equivale alla conferma professionale.</small></div>
  </form>
  {#if latestScenario}
    <section class:blocked={latestScenario.status === "blocked"} class="decision-confirmation">
      <div><strong>{latestScenario.status === "blocked" ? "Proposta da correggere" : latestScenario.status === "confirmed" ? "Devoluzione confermata" : "Proposta pronta per la conferma"}</strong><span>{latestScenario.shares.length} attribuzioni · aggiornata {formatItalianDate(latestScenario.updatedAt)}</span></div>
      {#if latestScenario.status === "draft"}
        <form method="POST" action={confirmAction}><input type="hidden" name="declarationId" value={data.declaration.id} /><input type="hidden" name="expectedRevision" value={data.declaration.revision} /><input type="hidden" name="scenarioId" value={latestScenario.id} /><button class="button primary" type="submit">Conferma professionalmente</button></form>
      {/if}
    </section>
  {/if}
{/if}
{#if form?.devolutionError}<p class="workspace-form-error" role="alert">{form.devolutionError}</p>{/if}
