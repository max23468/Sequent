<script lang="ts">
  import { Printer } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";
  let { data } = $props();

  const roleLabels: Record<string, string> = {
    decedent: "Defunto",
    beneficiary: "Beneficiario",
    representative: "Rappresentante",
    other: "Altro soggetto",
  };
  const categoryLabels: Record<string, string> = {
    property: "Immobile o terreno",
    financial: "Rapporto finanziario",
    other_asset: "Altro bene",
    liability: "Passività",
    donation: "Donazione",
  };
  function printSummary() {
    window.print();
  }
  function money(value: string | bigint): string {
    const cents = BigInt(value);
    const absolute = cents < 0n ? -cents : cents;
    const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${cents < 0n ? "−" : ""}${euros},${(absolute % 100n).toString().padStart(2, "0")} €`;
  }
  function bytes(value: number): string {
    return value < 1024 * 1024
      ? `${Math.round(value / 1024)} KB`
      : `${(value / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB`;
  }
</script>

<svelte:head><title>Riepilogo · {data.practice.title} · Sequent</title></svelte:head>

<div class="summary-page">
  <header>
    <div><p>Sequent</p><h1>{data.practice.title}</h1><span>Riepilogo della dichiarazione · {formatItalianDate(data.generatedAt)}</span></div>
    <div class="summary-actions"><a class="button primary" href={`/pratiche/${data.practice.id}/facsimile.pdf?dichiarazione=${data.declaration.id}`} target="_blank" rel="noreferrer">Apri fac-simile</a><a class="button secondary" href={`/pratiche/${data.practice.id}/facsimile.pdf?dichiarazione=${data.declaration.id}&download=1`} download>Scarica PDF</a><a class="button secondary" href={`/pratiche/${data.practice.id}/riepilogo.pdf?dichiarazione=${data.declaration.id}`}>Scarica il dossier</a><a class="button secondary" href={`/pratiche/${data.practice.id}/riepilogo.json?dichiarazione=${data.declaration.id}`}>Scarica i dati</a><button class="button secondary print-action" type="button" onclick={printSummary}><Printer size={18} />Stampa</button></div>
  </header>

  <div class:ready={data.report.ready} class="summary-status"><strong>{data.report.ready ? "Controlli disponibili superati" : "Bozza — controlli da completare"}</strong><span>{data.report.ready ? "Il riepilogo non sostituisce il controllo con SuccessioniOnLine." : "Non usare questa bozza per la presentazione della dichiarazione."}</span></div>

  <section><h2>Dichiarazione</h2><dl><div><dt>Tipo</dt><dd>{data.declaration.declaration.declarationKind === "first" ? "Prima dichiarazione" : `Sostitutiva tipo ${data.declaration.declaration.declarationKind.at(-1)}`}</dd></div><div><dt>Revisione</dt><dd>{data.declaration.revision}</dd></div><div><dt>Data di apertura</dt><dd>{data.declaration.declaration.successionOpenedAt ? formatItalianDate(data.declaration.declaration.successionOpenedAt) : "Non indicata"}</dd></div></dl></section>

  <section><h2>Verifica delle fonti e dei documenti</h2><dl><div><dt>Fonti di riferimento</dt><dd>{data.officialSourceLabel}</dd></div><div><dt>Quadri compilati</dt><dd>{data.report.qualification.quadriPresent.join(", ") || "Nessuno"}</dd></div><div><dt>Controllo dell’Agenzia</dt><dd>Versione {data.report.qualification.officialControl.version} · {data.report.qualification.officialControl.blockingDiagnostics === 0 ? "la pratica di prova non presenta errori bloccanti" : `${data.report.qualification.officialControl.blockingDiagnostics} errori bloccanti`}</dd></div><div><dt>Allegati preparati</dt><dd>{data.report.qualification.attachments.files} file · {bytes(data.report.qualification.attachments.totalBytes)}{data.report.qualification.attachments.formats.length ? ` · ${data.report.qualification.attachments.formats.join(", ")}` : ""}</dd></div><div><dt>Eccezioni motivate</dt><dd>{data.report.qualification.attachments.motivatedExceptions}</dd></div></dl></section>

  <section><h2>Soggetti</h2>{#if data.subjects.length === 0}<p class="empty-copy">Nessun soggetto registrato.</p>{:else}<table><thead><tr><th>Nome o denominazione</th><th>Ruolo</th><th>Codice fiscale</th></tr></thead><tbody>{#each data.subjects as subject (subject.id)}<tr><td>{subject.displayName}</td><td>{roleLabels[subject.role]}</td><td>{subject.taxCode ?? "—"}</td></tr>{/each}</tbody></table>{/if}</section>

  <section><h2>Beni e passività</h2>{#if data.assets.length === 0}<p class="empty-copy">Nessun bene o passività registrato.</p>{:else}<table><thead><tr><th>Descrizione</th><th>Categoria</th></tr></thead><tbody>{#each data.assets as asset (asset.id)}<tr><td>{asset.displayName}</td><td>{categoryLabels[asset.category]}</td></tr>{/each}</tbody></table>{/if}</section>

  <section><h2>Devoluzione</h2>{#if !data.devolution}<p class="empty-copy">La devoluzione non è ancora stata confermata.</p>{:else}<table><thead><tr><th>Bene</th><th>Beneficiario</th><th>Quota</th><th>Valore</th></tr></thead><tbody>{#each data.devolution.shares as share (`${share.assetId}:${share.beneficiaryId}`)}<tr><td>{data.assets.find((asset) => asset.id === share.assetId)?.displayName ?? "—"}</td><td>{data.subjects.find((subject) => subject.id === share.beneficiaryId)?.displayName ?? "—"}</td><td>{share.numerator}/{share.denominator}</td><td>{money(share.valueCents)}</td></tr>{/each}</tbody></table>{/if}</section>

  <section><h2>Calcolo dell’imposta</h2>{#if !data.calculation}<p class="empty-copy">Il calcolo non è ancora stato confermato.</p>{:else}<p><strong>Imposta complessiva: {money(data.calculation.totalTaxCents)}</strong></p><table><thead><tr><th>Voce</th><th>Importo</th></tr></thead><tbody><tr><td>Attivo</td><td>{money(data.calculation.declarationTaxes.estate.totalAssetsCents)}</td></tr><tr><td>Passivo</td><td>{money(data.calculation.declarationTaxes.estate.totalLiabilitiesCents)}</td></tr><tr><td>Asse ereditario netto</td><td>{money(data.calculation.declarationTaxes.estate.netEstateCents)}</td></tr><tr><td>Imposta ipotecaria</td><td>{money(data.calculation.declarationTaxes.mortgageTax.payableCents)}</td></tr><tr><td>Imposta catastale</td><td>{money(data.calculation.declarationTaxes.cadastralTax.payableCents)}</td></tr><tr><td>Da versare con la dichiarazione</td><td>{money(data.calculation.declarationTaxes.totalAtSubmissionCents)}</td></tr></tbody></table><h3>Ripartizione per beneficiario</h3><table><thead><tr><th>Beneficiario</th><th>Attivo netto</th><th>Franchigia</th><th>Imposta lorda</th><th>Imposta netta</th></tr></thead><tbody>{#each data.calculation.beneficiaries as result (result.beneficiaryId)}<tr><td>{data.subjects.find((subject) => subject.id === result.beneficiaryId)?.displayName ?? "—"}</td><td>{money(result.an)}</td><td>{money(result.fr)}</td><td>{money(result.isl)}</td><td>{money(result.isn)}</td></tr>{/each}</tbody></table>{/if}</section>

  <section><h2>Documenti richiesti</h2><table><thead><tr><th>Documento</th><th>Stato</th></tr></thead><tbody>{#each data.report.checklist.filter((item) => item.status !== "not_applicable") as item (item.id)}<tr><td>{item.label}</td><td>{item.status === "available" ? "Disponibile" : item.status === "overridden" ? "Deroga motivata" : "Mancante"}</td></tr>{/each}</tbody></table></section>

  <section><h2>Controlli</h2>{#if data.report.issues.length === 0}<p>Nessun problema rilevato dai controlli già disponibili.</p>{:else}<ul>{#each data.report.issues as issue (issue.id + (issue.fieldId ?? ""))}<li><strong>{issue.message}</strong><span>Riferimento {issue.sourceId}</span></li>{/each}</ul>{/if}</section>

  <footer><span>Codice di verifica del riepilogo: {data.report.digest}</span><span>Fonti ministeriali utilizzate: {data.officialSourceLabel}</span></footer>
</div>

<style>
  .summary-page { width: min(100% - 40px, 980px); margin: 34px auto 70px; color: var(--text); }
  header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 25px; border-bottom: 2px solid var(--navy); }
  .summary-actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
  header p { margin: 0 0 6px; color: var(--teal); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
  header h1 { margin: 0 0 7px; font-size: 2rem; }
  header span, .empty-copy { color: var(--muted); }
  .summary-status { display: grid; gap: 5px; margin: 22px 0; padding: 15px 18px; border-left: 4px solid #b7791f; background: color-mix(in srgb, #b7791f 7%, var(--surface)); }
  .summary-status.ready { border-left-color: var(--success); background: color-mix(in srgb, var(--success) 7%, var(--surface)); }
  .summary-status span { color: var(--muted); font-size: .84rem; }
  section { margin-top: 30px; break-inside: avoid; }
  section h2 { margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); font-size: 1.25rem; }
  dl { margin: 0; }
  dl div { display: grid; grid-template-columns: 190px 1fr; gap: 16px; padding: 8px 0; }
  dt { color: var(--muted); } dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 8px; border-bottom: 1px solid var(--line-soft); text-align: left; font-size: .86rem; }
  th { color: var(--muted); font-size: .75rem; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { display: grid; gap: 4px; padding: 10px 3px; border-bottom: 1px solid var(--line-soft); }
  li span { color: var(--muted); font-size: .76rem; }
  footer { display: grid; gap: 5px; margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: .68rem; overflow-wrap: anywhere; }
  @media print { :global(body .topbar), :global(body .mobile-navigation), .summary-page .summary-actions { display: none; } :global(body .main-content) { padding: 0; } .summary-page { width: auto; margin: 0; } }
  @media (max-width: 640px) { header { flex-direction: column; } .print-action { align-self: flex-start; } dl div { grid-template-columns: 1fr; gap: 2px; } }
</style>
