<script lang="ts">
  import { page } from "$app/state";
  import {
    Building2,
    Calculator,
    CircleAlert,
    FileOutput,
    History,
    PackageCheck,
    ShieldCheck,
    UserRound,
    UsersRound,
  } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";
  import type { ActionData, PageData } from "../../routes/pratiche/[id]/$types";
  import DevolutionSection from "./DevolutionSection.svelte";

  let {
    data,
    form,
    selectedSection,
    createDeclarationAction,
    addSubjectAction,
    addAssetAction,
    checklistAction,
    saveDevolutionAction,
    confirmDevolutionAction,
    runCalculationAction,
    confirmCalculationAction,
  } = $props<{
    data: PageData;
    form: ActionData | null;
    selectedSection: string;
    createDeclarationAction: string;
    addSubjectAction: string;
    addAssetAction: string;
    checklistAction: string;
    saveDevolutionAction: string;
    confirmDevolutionAction: string;
    runCalculationAction: string;
    confirmCalculationAction: string;
  }>();

  const assetKindLabels: Record<string, string> = {
    land: "Terreno",
    building: "Fabbricato",
    tavolare_land: "Terreno nel sistema tavolare",
    tavolare_building: "Fabbricato nel sistema tavolare",
    company: "Azienda",
    securities: "Titoli o quote sociali",
    aircraft: "Aeromobile",
    vessel: "Nave o imbarcazione",
    money: "Denaro, gioielli o mobilia",
    inventory: "Beni descritti in inventario",
    other: "Altro bene o credito",
    liability: "Passività",
    donation: "Donazione precedente",
  };

  const latestCalculation = $derived(data.calculationRuns.at(0) ?? null);

  function subjectTaxCode(subject: (typeof data.subjects)[number]): string {
    return subject.taxCode ?? "";
  }

  function declarationHref(declarationId: string): string {
    const search = new URLSearchParams(page.url.searchParams);
    search.set("sezione", "declaration");
    search.set("dichiarazione", declarationId);
    return `${page.url.pathname}?${search.toString()}`;
  }

  function paymentPlanText(
    plan: NonNullable<(typeof data.calculationRuns)[number]["paymentPlan"]>,
  ): string {
    return plan.installments > 1
      ? `Acconto di ${money(plan.initialPaymentCents)} e residuo di ${money(plan.remainingCents)} in ${plan.installments} rate. Scadenza ordinaria: ${formatItalianDate(plan.paymentDeadline)}.`
      : `Imposta di successione da versare entro il ${formatItalianDate(plan.paymentDeadline)}.`;
  }

  function money(value: string | bigint): string {
    const cents = BigInt(value);
    const absolute = cents < 0n ? -cents : cents;
    const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${cents < 0n ? "−" : ""}${euros},${(absolute % 100n).toString().padStart(2, "0")} €`;
  }

</script>

{#if selectedSection === "declaration"}
  <div class="workspace-panel-heading"><h2>Defunto e dichiarazione</h2><span>{data.declarations.length}</span></div>
  <div class="domain-section">
    <div class="declaration-list">
      {#each data.declarations as declaration (declaration.id)}
        <a class:active={declaration.id === data.declaration.id} href={declarationHref(declaration.id)}><span>Dichiarazione {declaration.sequence}</span><strong>{declaration.declaration.declarationKind === "first" ? "Prima dichiarazione" : `Sostitutiva tipo ${declaration.declaration.declarationKind.at(-1)}`}</strong><small>Revisione {declaration.revision} · {formatItalianDate(declaration.updatedAt)}</small></a>
      {/each}
    </div>
    <form class="domain-inline-form" method="POST" action={createDeclarationAction}>
      <h3>Aggiungi una dichiarazione successiva</h3>
      <label for="declaration-kind">Tipo</label>
      <select id="declaration-kind" name="kind"><option value="substitute-1">Sostitutiva tipo 1</option><option value="substitute-2">Sostitutiva tipo 2</option><option value="substitute-3">Sostitutiva tipo 3</option></select>
      <input type="hidden" name="sourceDeclarationId" value={data.declaration.id} />
      <button class="button secondary" type="submit">Crea da una copia controllata</button>
    </form>
  </div>
{:else if selectedSection === "beneficiaries"}
  <div class="workspace-panel-heading"><h2>Soggetti</h2><span>{data.subjects.length}</span></div>
  <div class="domain-section">
    {#if data.subjects.length === 0}
      <div class="panel-empty domain-empty"><UsersRound size={27} /><p>Nessun soggetto registrato.</p><span>Defunto, beneficiari e rappresentanti sono condivisi fra le dichiarazioni della pratica.</span></div>
    {:else}
      <ul class="domain-entity-list">
        {#each data.subjects as subject (subject.id)}
          {@const taxCode = subjectTaxCode(subject)}
          <li><UserRound size={19} /><span><strong>{subject.displayName}</strong><small>{subject.role === "decedent" ? "Defunto" : subject.role === "beneficiary" ? "Beneficiario" : subject.role === "representative" ? "Rappresentante" : "Altro soggetto"}{taxCode ? ` · ${taxCode}` : ""}</small></span></li>
        {/each}
      </ul>
    {/if}
    <form class="domain-inline-form" method="POST" action={addSubjectAction}>
      <h3>Aggiungi un soggetto</h3>
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <label for="subject-role">Ruolo</label>
      <select id="subject-role" name="role"><option value="decedent">Defunto</option><option value="beneficiary">Beneficiario</option><option value="representative">Rappresentante</option><option value="other">Altro soggetto</option></select>
      <label for="subject-name">Nome o denominazione</label><input id="subject-name" name="displayName" maxlength="160" required />
      <label for="subject-tax-code">Codice fiscale</label><input id="subject-tax-code" name="taxCode" maxlength="32" />
      <button class="button primary" type="submit">Aggiungi</button>
    </form>
  </div>
{:else if selectedSection === "assets"}
  <div class="workspace-panel-heading"><h2>Beni e passività</h2><span>{data.assets.length}</span></div>
  <div class="domain-section">
    {#if data.assets.length === 0}
      <div class="panel-empty domain-empty"><Building2 size={27} /><p>Nessun bene o passività registrato.</p><span>Ogni elemento viene registrato una sola volta e poi ripreso nel Quadro pertinente.</span></div>
    {:else}
      <ul class="domain-entity-list">{#each data.assets as asset (asset.id)}<li><Building2 size={19} /><span><strong>{asset.displayName}</strong><small>{assetKindLabels[asset.kind]} · {money(asset.valueCents)}{asset.quadro ? ` · Quadro ${asset.quadro}` : ""}</small></span></li>{/each}</ul>
    {/if}
    <form class="domain-inline-form" method="POST" action={addAssetAction}>
      <h3>Aggiungi un bene o una passività</h3>
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <label for="asset-kind">Tipo</label>
      <select id="asset-kind" name="kind">
        {#each Object.entries(assetKindLabels) as [value, label] (value)}<option {value}>{label}</option>{/each}
      </select>
      <label for="asset-name">Descrizione</label><input id="asset-name" name="displayName" maxlength="160" required />
      <label for="asset-value">Valore iniziale</label><input id="asset-value" name="value" inputmode="decimal" placeholder="0,00" />
      <small class="form-help">Il valore fiscale viene verificato nel Quadro corrispondente prima della ripartizione e del calcolo.</small>
      <button class="button primary" type="submit">Aggiungi</button>
    </form>
  </div>
{:else if selectedSection === "checklist"}
  <div class="workspace-panel-heading"><h2>Documenti richiesti</h2><span>{data.checklist.filter((item: { status: string }) => item.status !== "not_applicable").length}</span></div>
  <form class="checklist-form" method="POST" action={checklistAction}>
    <input type="hidden" name="declarationId" value={data.declaration.id} />
    <div class="checklist-groups">
      {#each data.checklist.filter((item: { status: string }) => item.status !== "not_applicable") as item (item.id)}
        <section class="checklist-row">
          <input type="hidden" name="itemId" value={item.id} />
          <PackageCheck size={19} />
          <div><strong>{item.label}</strong><small>{item.importance === "blocking" ? "Necessario" : item.importance === "conditional" ? "Da acquisire quando disponibile" : "Consigliato"}</small></div>
          <label><span>Stato</span><select name={`status:${item.id}`}><option value="missing" selected={item.status === "missing"}>Mancante</option><option value="available" selected={item.status === "available"}>Disponibile</option>{#if item.importance !== "blocking"}<option value="overridden" selected={item.status === "overridden"}>Deroga motivata</option>{/if}</select></label>
          <label><span>Documento</span><select name={`documentId:${item.id}`}><option value="">Non collegato</option>{#each data.documents as sourceDocument (sourceDocument.id)}<option value={sourceDocument.id} selected={item.documentId === sourceDocument.id}>{sourceDocument.originalName}</option>{/each}</select></label>
          <label class="checklist-note"><span>Nota</span><input name={`decisionNote:${item.id}`} value={item.decisionNote ?? ""} placeholder={item.importance === "blocking" ? "Il documento necessario non ammette deroga" : "Necessaria per una deroga"} /></label>
        </section>
      {/each}
    </div>
    <div class="official-fields-actions"><button class="button primary" type="submit">Salva documenti richiesti</button><small>Tutte le modifiche vengono salvate insieme.</small></div>
  </form>
  {#if form?.checklistError}<p class="workspace-form-error" role="alert">{form.checklistError}</p>{/if}
{:else if selectedSection === "devolution"}
  <DevolutionSection {data} {form} saveAction={saveDevolutionAction} confirmAction={confirmDevolutionAction} {assetKindLabels} />
{:else if selectedSection === "calculations"}
  <div class="workspace-panel-heading"><h2>Calcoli</h2><span>{data.declaration.declaration.latestCalculationRunId ? "Confermati" : "Da confermare"}</span></div>
  <div class="calculation-actions"><div><Calculator size={25} /><span><strong>Calcolo dell’imposta di successione</strong><small>Applica le regole ufficiali alle quote della devoluzione confermata.</small></span></div><form method="POST" action={runCalculationAction}><input type="hidden" name="declarationId" value={data.declaration.id} /><button class="button primary" type="submit">Esegui il calcolo</button></form></div>
  {#if latestCalculation}
    <section class="calculation-result">
      <header><div><strong>Imposta complessiva: {money(latestCalculation.totalTaxCents)}</strong><span>{latestCalculation.status === "confirmed" ? "Calcolo confermato" : latestCalculation.status === "blocked" ? "Dati da completare" : "Calcolo da confermare"}</span></div></header>
      {#each latestCalculation.beneficiaries as result (result.beneficiaryId)}
        {@const subject = data.subjects.find((candidate: { id: string }) => candidate.id === result.beneficiaryId)}
        <div class="calculation-beneficiary"><h3>{subject?.displayName ?? "Beneficiario"}</h3><dl><div><dt>Quota ereditaria</dt><dd>{money(result.qe)}</dd></div><div><dt>Denaro, gioielli e mobilia</dt><dd>{money(result.qdn)}</dd></div><div><dt>Passività</dt><dd>{money(result.qp)}</dd></div><div><dt>Attivo netto</dt><dd>{money(result.an)}</dd></div><div><dt>Franchigia</dt><dd>{money(result.fr)}</dd></div><div><dt>Presunzione</dt><dd>{money(result.pr)}</dd></div><div><dt>Imposta lorda</dt><dd>{money(result.isl)}</dd></div><div><dt>Riduzioni</dt><dd>{money(result.reductions)}</dd></div><div><dt>Imposta estera detraibile</dt><dd>{money(result.foreignTaxCredit)}</dd></div><div><dt>Imposta netta</dt><dd>{money(result.isn)}</dd></div></dl></div>
      {/each}
      <section class="calculation-totals" aria-labelledby="calculation-totals-title">
        <h3 id="calculation-totals-title">Riepilogo della dichiarazione</h3>
        <div class="calculation-summary-grid">
          <dl>
            <div><dt>Attivo</dt><dd>{money(latestCalculation.declarationTaxes.estate.totalAssetsCents)}</dd></div>
            <div><dt>Passivo</dt><dd>{money(latestCalculation.declarationTaxes.estate.totalLiabilitiesCents)}</dd></div>
            <div><dt>Asse ereditario netto</dt><dd>{money(latestCalculation.declarationTaxes.estate.netEstateCents)}</dd></div>
          </dl>
          <dl>
            <div><dt>Imposta ipotecaria</dt><dd>{money(latestCalculation.declarationTaxes.mortgageTax.payableCents)}</dd></div>
            <div><dt>Imposta catastale</dt><dd>{money(latestCalculation.declarationTaxes.cadastralTax.payableCents)}</dd></div>
            <div><dt>Servizi, bollo e tributi speciali</dt><dd>{money(latestCalculation.declarationTaxes.mortgageServicesCents + latestCalculation.declarationTaxes.stampDutyCents + latestCalculation.declarationTaxes.specialTaxesCents)}</dd></div>
          </dl>
          <dl>
            <div><dt>Imposta di successione dovuta</dt><dd>{money(latestCalculation.declarationTaxes.successionTax.payableCents)}</dd></div>
            <div><dt>Sanzioni e interessi</dt><dd>{money(latestCalculation.declarationTaxes.penaltiesCents + latestCalculation.declarationTaxes.interestCents)}</dd></div>
            <div class="calculation-total-row"><dt>Da versare con la dichiarazione</dt><dd>{money(latestCalculation.declarationTaxes.totalAtSubmissionCents)}</dd></div>
          </dl>
        </div>
        {#if latestCalculation.paymentPlan}
          <p class="calculation-payment-note">{paymentPlanText(latestCalculation.paymentPlan)}</p>
        {/if}
      </section>
      {#if latestCalculation.status === "draft"}
        <form class="calculation-confirm" method="POST" action={confirmCalculationAction}><input type="hidden" name="declarationId" value={data.declaration.id} /><input type="hidden" name="expectedRevision" value={data.declaration.revision} /><input type="hidden" name="calculationId" value={latestCalculation.id} /><button class="button primary" type="submit">Conferma il calcolo</button></form>
      {/if}
    </section>
  {/if}
  {#if form?.calculationError}<p class="workspace-form-error" role="alert">{form.calculationError}</p>{/if}
{:else if selectedSection === "checks"}
  <div class="workspace-panel-heading"><h2>Controlli</h2><span>{data.declarationIssues.length}</span></div>
  {#if data.declarationIssues.length === 0}
    <div class="panel-empty workspace-empty"><ShieldCheck size={27} /><p>Nessun problema sui dati inseriti.</p><span>I controlli coprono struttura, regole ufficiali, documenti, devoluzione e calcoli.</span></div>
  {:else}
    <ul class="checks-list">{#each data.declarationIssues as issue (issue.id + (issue.fieldId ?? ""))}<li><CircleAlert size={19} /><span><strong>{issue.message}</strong><small>Fonte: {issue.sourceId}</small></span></li>{/each}</ul>
  {/if}
{:else if selectedSection === "exports"}
  <div class="workspace-panel-heading"><h2>Riepilogo ed esportazione</h2><span>{data.declarationReady ? "Disponibile" : "Bozza"}</span></div>
  <div class="export-grid">
    <article><FileOutput size={28} /><h3>Fac-simile del modello</h3><p>Frontespizio e quadri pertinenti sul modello ufficiale, marcati come non trasmettibili.</p><a class="button primary" href={`/pratiche/${data.practice.id}/facsimile.pdf?dichiarazione=${data.declaration.id}`}>Scarica il fac-simile</a></article>
    <article><FileOutput size={28} /><h3>Dossier della pratica</h3><p>Soggetti, beni, devoluzione, calcoli, documenti richiesti e controlli.</p><a class="button primary" href={`/pratiche/${data.practice.id}/riepilogo?dichiarazione=${data.declaration.id}`} target="_blank">Apri il dossier</a><a class="button secondary" href={`/pratiche/${data.practice.id}/riepilogo.pdf?dichiarazione=${data.declaration.id}`}>Scarica il dossier</a></article>
    <article><ShieldCheck size={28} /><h3>Rapporto dei controlli</h3><p>Esito riproducibile con fonti applicate e codice di verifica.</p><a class="button secondary" href={`/pratiche/${data.practice.id}/riepilogo.json?dichiarazione=${data.declaration.id}`} target="_blank">Scarica i dati</a></article>
  </div>
{:else if selectedSection === "history"}
  <div class="workspace-panel-heading"><h2>Cronologia</h2><span>{data.auditEvents.length}</span></div>
  {#if data.auditEvents.length === 0}
    <div class="panel-empty workspace-empty"><History size={27} /><p>Nessuna modifica rilevante registrata.</p><span>Le decisioni e le modifiche compariranno qui.</span></div>
  {:else}
    <ol class="audit-list">{#each data.auditEvents as event (event.id)}<li><span>{event.summary}</span><time datetime={event.createdAt}>{formatItalianDate(event.createdAt)}</time></li>{/each}</ol>
  {/if}
{/if}
