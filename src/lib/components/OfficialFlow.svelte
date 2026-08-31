<script lang="ts">
  import {
    ArrowDownToLine,
    ArrowUpFromLine,
    CheckCircle2,
    FileCheck2,
    ShieldAlert,
  } from "@lucide/svelte";
  import { formatItalianDate, formatMegabytes } from "$lib/format";
  import type {
    DizRoundTrip,
    OfficialArtifact,
    OfficialFlowEvent,
    OfficialFlowSummary,
  } from "$lib/server/official-flow";

  interface OfficialFlowData {
    officialFlow: OfficialFlowSummary;
    declaration: { id: string };
    declarationReady: boolean;
    practice: { id: string };
    dizEnabled: boolean;
  }

  interface DizAcquisition {
    mappedFields: number;
    importedFields: number;
    unchangedFields: number;
    conflictingFields: number;
    missingTargets: number;
    preservedFields: number;
    converterOnlyFields: number;
    opaqueFields: number;
    createdSubjects: number;
    createdAssets: number;
    createdDecedent: boolean;
  }

  let { data, form, actionUrl } = $props<{
    data: OfficialFlowData;
    form: object | null;
    actionUrl: (action: string) => string;
  }>();
  let officialFlowError = $derived.by(() => {
    if (!form || !("officialFlowError" in form)) return null;
    const value = (form as { officialFlowError?: unknown }).officialFlowError;
    return typeof value === "string" ? value : null;
  });
  const labels: Record<string, string> = {
    "diz-imported": "DIZ acquisito",
    "diz-exported": "DIZ esportato",
    "diz-reimported": "DIZ reimportato",
    telematic: "File telematico",
    "official-diagnostic": "Esito del controllo ufficiale",
    print: "Stampa della dichiarazione",
    "receipt-first": "Prima ricevuta · trasmissione",
    "receipt-second": "Seconda ricevuta · registrazione",
    "receipt-third": "Terza ricevuta · pagamento",
    "payment-receipt": "Quietanza di pagamento",
    "cadastral-result": "Esito delle volture",
    "other-official": "Altro documento ufficiale",
  };
  let latestExport = $derived(
    data.officialFlow.artifacts.find(
      (artifact: OfficialArtifact) => artifact.kind === "diz-exported",
    ) ?? null,
  );
  let latestImport = $derived(
    data.officialFlow.artifacts.find(
      (artifact: OfficialArtifact) => artifact.kind === "diz-imported",
    ) ?? null,
  );
  function isAcquisitionCount(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
  }
  let latestAcquisition = $derived.by(() => {
    const acquisition = latestImport?.metadata.acquisition;
    if (!acquisition || typeof acquisition !== "object") return null;
    const candidate = acquisition as Partial<DizAcquisition>;
    return isAcquisitionCount(candidate.mappedFields) &&
      isAcquisitionCount(candidate.importedFields) &&
      isAcquisitionCount(candidate.unchangedFields) &&
      isAcquisitionCount(candidate.conflictingFields) &&
      isAcquisitionCount(candidate.missingTargets) &&
      isAcquisitionCount(candidate.preservedFields) &&
      isAcquisitionCount(candidate.converterOnlyFields) &&
      isAcquisitionCount(candidate.opaqueFields) &&
      isAcquisitionCount(candidate.createdSubjects) &&
      isAcquisitionCount(candidate.createdAssets) &&
      typeof candidate.createdDecedent === "boolean"
      ? (candidate as DizAcquisition)
      : null;
  });
  let acquisitionNeedsRepair = $derived(
    Boolean(latestImport) &&
      (latestImport?.metadata.acquisition as { version?: unknown } | undefined)?.version !== 2,
  );
  let presentationConfirmation = $derived(
    data.officialFlow.events.find(
      (event: OfficialFlowEvent) => event.eventType === "presentation-confirmed",
    ) ?? null,
  );
  let latestOpaqueChange = $derived(
    data.officialFlow.roundTrips.find(
      (roundTrip: DizRoundTrip) =>
        roundTrip.comparison?.opaqueEvidence?.changed ||
        (roundTrip.comparison?.opaque?.length ?? 0) > 0,
    ) ?? null,
  );

  function conflictKey(field: { quadro: string; module: string; field: string }) {
    return `${field.quadro}|${field.module}|${field.field}`;
  }
</script>

<div class="official-flow">
  <header class="official-flow-status">
    <div class="official-flow-status-icon"><FileCheck2 size={23} /></div>
    <div><span>Flusso ufficiale</span><strong>{data.officialFlow.stageLabel}</strong></div>
  </header>
  <details class="official-stage-override">
    <summary>Correggi lo stato derivato</summary>
    <form method="POST" action={actionUrl("overrideOfficialStage")} class="official-artifact-form">
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <label>Stato<select name="stage" required>
        <option value="draft">Preparazione interna</option>
        <option value="diz-imported">DIZ acquisito</option>
        <option value="diz-exported">DIZ esportato</option>
        <option value="diz-reimported">DIZ reimportato</option>
        <option value="telematic-generated">Telematico generato</option>
        <option value="official-control-passed">Controllo ufficiale superato</option>
        <option value="transmitted">Trasmessa</option>
        <option value="presented">Presentata e registrata</option>
        <option value="cadastral-processing">Volture in lavorazione</option>
        <option value="closed">Chiusa</option>
      </select></label>
      <label class="official-confirmation-reason">Motivazione<textarea name="reason" minlength="10" maxlength="1000" required></textarea></label>
      <button class="button secondary" type="submit">Registra correzione</button>
    </form>
    {#if data.officialFlow.stageOverride}<p class="official-flow-note">Ultima correzione: {data.officialFlow.stageOverride.reason}</p>{/if}
  </details>

  {#if !data.dizEnabled}
    <div class="technical-alert" role="status">
      <ShieldAlert size={20} />
      <div><strong>DIZ non attivo</strong><p>La capacità resta disabilitata in questo ambiente. I file già acquisiti rimangono consultabili.</p></div>
    </div>
  {/if}
  {#if officialFlowError}<p class="workspace-form-error" role="alert">{officialFlowError}</p>{/if}

  <section class="official-flow-card">
    <div class="official-flow-card-heading"><span>1</span><div><h3>Pratica modificabile</h3><p>Acquisisci un DIZ qualificato come base. L’importazione crea uno snapshot e non sovrascrive silenziosamente i dati.</p></div></div>
    <form method="POST" action={actionUrl("importDiz")} enctype="multipart/form-data" class="official-flow-form compact">
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <label class="file-picker" for="official-diz-import"><ArrowUpFromLine size={17} /><span>Scegli DIZ</span></label>
      <input id="official-diz-import" name="file" type="file" accept=".diz,application/zip" required />
      <button class="button secondary" type="submit" disabled={!data.dizEnabled || data.officialFlow.pendingRoundTrip}>Acquisisci</button>
    </form>
    {#if latestAcquisition}
      {@const acquisitionIncomplete = latestAcquisition.conflictingFields > 0 || latestAcquisition.missingTargets > 0}
      <div class="diz-acquisition-summary" class:incomplete={acquisitionIncomplete} role={acquisitionIncomplete ? "alert" : "status"}>
        <strong>{acquisitionIncomplete ? "Acquisizione da completare" : "Dati acquisiti nella dichiarazione"}</strong>
        <p>{latestAcquisition.importedFields} nuovi dati in Da verificare · {latestAcquisition.unchangedFields} già coincidenti · {latestAcquisition.preservedFields} conservati soltanto nell’originale.</p>
        {#if latestAcquisition.createdSubjects > 0 || latestAcquisition.createdAssets > 0 || latestAcquisition.createdDecedent}
          <p>Struttura creata dal DIZ: {latestAcquisition.createdSubjects} soggetti · {latestAcquisition.createdAssets} beni o passività{latestAcquisition.createdDecedent ? " · defunto" : ""}.</p>
        {/if}
        {#if acquisitionIncomplete}
          <p>{latestAcquisition.conflictingFields} valori differiscono dai dati esistenti e {latestAcquisition.missingTargets} posizioni non sono collegate. Nessun dato esistente è stato sostituito.</p>
          <a href={`?vista=quadri&sezione=quadri&quadro=EA&dichiarazione=${data.declaration.id}`}>Controlla il Quadro EA</a>
        {/if}
      </div>
    {:else if acquisitionNeedsRepair && latestImport}
      <div class="diz-acquisition-summary incomplete" role="alert">
        <strong>Integrazione DIZ da aggiornare</strong>
        <p>Il file originale è integro, ma questa importazione usa ancora la mappatura parziale precedente.</p>
        <form method="POST" action={actionUrl("repairImportedDiz")}>
          <input type="hidden" name="declarationId" value={data.declaration.id} />
          <input type="hidden" name="artifactId" value={latestImport.id} />
          <button class="button secondary" type="submit" disabled={!data.dizEnabled}>Integra tutti i contenuti</button>
        </form>
      </div>
    {/if}
  </section>

  <section class="official-flow-card">
    <div class="official-flow-card-heading"><span>2</span><div><h3>Controllo in SuccessioniOnLine</h3><p>Genera il DIZ solo quando i controlli interni e gli allegati sono completi. Il download non equivale al controllo ufficiale.</p></div></div>
    <div class="official-flow-actions">
      <form method="POST" action={actionUrl("exportDiz")}>
        <input type="hidden" name="declarationId" value={data.declaration.id} />
        <button class="button primary" type="submit" disabled={!data.dizEnabled || !data.declarationReady || data.officialFlow.pendingRoundTrip}>Genera DIZ</button>
      </form>
      {#if latestExport}
        <a class="button secondary" href={`/pratiche/${data.practice.id}/artefatti/${latestExport.id}`}><ArrowDownToLine size={17} />Scarica ultimo DIZ</a>
      {/if}
    </div>
    {#if !data.declarationReady}<p class="official-flow-note">I controlli finali indicano ancora elementi bloccanti.</p>{/if}
    {#if data.officialFlow.pendingRoundTrip}<p class="official-flow-note">Completa il ciclo DIZ aperto prima di generarne uno nuovo.</p>{/if}

    {#if data.officialFlow.pendingRoundTrip?.status === "exported"}
      <form method="POST" action={actionUrl("reimportDiz")} enctype="multipart/form-data" class="official-flow-form reimport-form">
        <input type="hidden" name="declarationId" value={data.declaration.id} />
        <input type="hidden" name="roundTripId" value={data.officialFlow.pendingRoundTrip.id} />
        <label for="official-diz-reimport"><strong>Reimporta il DIZ salvato</strong><span>Dopo apertura e salvataggio nel programma ufficiale.</span></label>
        <input id="official-diz-reimport" name="file" type="file" accept=".diz,application/zip" required />
        <button class="button secondary" type="submit">Confronta a tre vie</button>
      </form>
    {:else if data.officialFlow.pendingRoundTrip?.status === "conflicts"}
      <form method="POST" action={actionUrl("resolveDiz")} class="diz-conflicts">
        <input type="hidden" name="declarationId" value={data.declaration.id} />
        <input type="hidden" name="roundTripId" value={data.officialFlow.pendingRoundTrip.id} />
        <h4>Scegli le differenze conflittuali</h4>
        {#each data.officialFlow.pendingRoundTrip.comparison?.conflicts ?? [] as conflict (conflictKey(conflict))}
          <fieldset>
            <legend>{conflict.quadro} · campo {conflict.field}</legend>
            <label><input type="radio" name={`conflict:${conflictKey(conflict)}`} value="current" required /><span><small>Sequent</small>{conflict.current ?? "Vuoto"}</span></label>
            <label><input type="radio" name={`conflict:${conflictKey(conflict)}`} value="official" required /><span><small>SuccessioniOnLine</small>{conflict.official ?? "Vuoto"}</span></label>
          </fieldset>
        {/each}
        <button class="button primary" type="submit">Conferma le scelte</button>
      </form>
    {/if}
    {#if latestOpaqueChange}
      <div class="technical-alert" role="status"><ShieldAlert size={19} /><div><strong>Contenuto opaco variato</strong><p>Le differenze non mappate restano nel DIZ ufficiale acquisito, ma non vengono promosse nei campi canonici.</p></div></div>
    {/if}
  </section>

  <section class="official-flow-card">
    <div class="official-flow-card-heading"><span>3</span><div><h3>Telematico, ricevute ed esiti</h3><p>Ogni invio resta distinto. La pratica è presentata solo con seconda ricevuta positiva e registrazione identificabile.</p></div></div>
    <form method="POST" action={actionUrl("addOfficialArtifact")} enctype="multipart/form-data" class="official-artifact-form">
      <input type="hidden" name="declarationId" value={data.declaration.id} />
      <label>File<input name="file" type="file" required /></label>
      <label>Esito, quando applicabile<select name="outcome">
        <option value="">Non indicato</option>
        <option value="passed">Controllo superato</option>
        <option value="failed">Controllo non superato</option>
        <option value="positive">Ricevuta positiva</option>
        <option value="negative">Esito negativo</option>
        <option value="complete">Volture completate</option>
        <option value="partial">Volture parziali</option>
      </select></label>
      <label>Data di registrazione<input name="registeredAt" type="date" /></label>
      <label>Estremi di registrazione<input name="registrationReference" maxlength="160" /></label>
      <label>Tipo<select name="kind">
        <option value="official-diagnostic">Esito controllo ufficiale</option>
        <option value="telematic">File telematico</option>
        <option value="print">Stampa dichiarazione</option>
        <option value="receipt-first">Prima ricevuta</option>
        <option value="receipt-second">Seconda ricevuta</option>
        <option value="receipt-third">Terza ricevuta</option>
        <option value="payment-receipt">Quietanza di pagamento</option>
        <option value="cadastral-result">Esito volture</option>
        <option value="other-official">Altro documento ufficiale</option>
      </select></label>
      <button class="button secondary" type="submit">Acquisisci esito</button>
    </form>
    {#if presentationConfirmation}
      <p class="official-flow-note">Presentazione confermata manualmente con estremi ufficiali perché la seconda ricevuta non era ottenibile.</p>
    {:else if data.officialFlow.stage !== "presented" && data.officialFlow.stage !== "cadastral-processing" && data.officialFlow.stage !== "closed"}
      <details class="official-manual-confirmation">
        <summary>La seconda ricevuta non è ottenibile</summary>
        <form method="POST" action={actionUrl("confirmPresentation")} class="official-artifact-form">
          <input type="hidden" name="declarationId" value={data.declaration.id} />
          <label>Data di registrazione<input name="registeredAt" type="date" required /></label>
          <label>Estremi ufficiali<input name="registrationReference" maxlength="160" required /></label>
          <label class="official-confirmation-reason">Motivazione<textarea name="reason" minlength="20" maxlength="2000" required></textarea></label>
          <button class="button secondary" type="submit">Conferma presentazione</button>
        </form>
      </details>
    {/if}
  </section>

  <section class="official-flow-card artifact-history">
    <div class="official-flow-card-heading"><CheckCircle2 size={22} /><div><h3>Fascicolo ufficiale</h3><p>{data.officialFlow.artifacts.length} file conservati</p></div></div>
    {#if data.officialFlow.artifacts.length === 0}
      <p class="official-flow-note">Nessun file ufficiale ancora acquisito.</p>
    {:else}
      <ul>
        {#each data.officialFlow.artifacts as artifact (artifact.id)}
          <li><div><strong>{labels[artifact.kind] ?? artifact.kind}</strong><span>{artifact.originalName} · {formatMegabytes(artifact.byteSize)} · {formatItalianDate(artifact.createdAt)}</span><code>SHA-256 {artifact.sha256}</code></div><a href={`/pratiche/${data.practice.id}/artefatti/${artifact.id}`} aria-label={`Scarica ${artifact.originalName}`}><ArrowDownToLine size={18} /></a></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
