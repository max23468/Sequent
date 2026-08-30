<script lang="ts">
  import { Activity, Bot, DatabaseBackup, ExternalLink, Palette, ShieldAlert, ShieldCheck } from "@lucide/svelte";
  import { formatItalianDate } from "$lib/format";
  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>Impostazioni · Sequent</title></svelte:head>
<div class="page-frame index-page">
  <div class="page-heading"><div><h1>Impostazioni</h1><p>Preferenze e collegamenti utili per il lavoro quotidiano.</p></div></div>
  <section class="settings-panel appearance-panel">
    <div class="panel-title"><Palette size={22} /><h2>Aspetto</h2></div>
    <div class="settings-row"><div><strong>Tema dell’interfaccia</strong><span>Segui il sistema oppure mantieni sempre il tema chiaro o scuro su questo dispositivo.</span></div><ThemeSelector /></div>
  </section>
  <section class="settings-panel">
    <div class="panel-title"><ExternalLink size={22} /><h2>Applicazioni esterne</h2></div>
    {#each data.launchers as launcher (launcher.id)}
      <div class="settings-row"><div><strong>{launcher.label}</strong><span>{launcher.instructions}</span></div><span class:available={launcher.state === "available"} class="capability-state">{#if launcher.state === "available"}<ShieldCheck size={17} />{:else if launcher.state === "disabled"}<ShieldAlert size={17} />{:else}<ExternalLink size={17} />{/if}{launcher.state === "available" ? "Disponibile" : launcher.state === "disabled" ? "Non attivo" : "Apertura manuale"}</span></div>
    {/each}
  </section>
  <section class="settings-panel">
    <div class="panel-title"><Activity size={22} /><h2>Stato dell’istanza</h2></div>
    <div class="settings-row"><div><strong>Dati e spazio disponibile</strong><span>{data.operations.databaseHealthy && data.operations.storageHealthy ? "Archivio coerente e spazio entro le soglie operative." : "È richiesta una verifica amministrativa prima di nuove operazioni rischiose."}</span></div><span class:available={data.operations.databaseHealthy && data.operations.storageHealthy} class="capability-state">{#if data.operations.databaseHealthy && data.operations.storageHealthy}<ShieldCheck size={17} />Regolare{:else}<ShieldAlert size={17} />Da verificare{/if}</span></div>
    <div class="settings-row"><div><strong>Errori di elaborazione negli ultimi 7 giorni</strong><span>Gli errori restano nella singola pratica con il dettaglio e l’azione di recupero.</span></div><span class:available={data.operations.recentErrors === 0} class="capability-state">{data.operations.recentErrors}</span></div>
  </section>
  <section class="settings-panel">
    <div class="panel-title"><DatabaseBackup size={22} /><h2>Backup manuale</h2></div>
    <div class="settings-row backup-settings-row"><div><strong>{data.backup ? `Ultimo backup: ${formatItalianDate(data.backup.createdAt)}` : "Nessun backup disponibile"}</strong><span>{data.backup?.reminder === "overdue" ? "Sono trascorsi almeno 14 giorni: crea ora una nuova copia verificata." : data.backup?.reminder === "due" ? "Sono trascorsi almeno 7 giorni: è consigliata una nuova copia." : "La copia include pratiche e documenti, ma esclude credenziali e sessioni."}</span></div><form method="POST" action="?/backup"><button class="button secondary" type="submit"><DatabaseBackup size={17} />Crea backup</button></form></div>
    {#if form?.backupCreated}<p class="settings-feedback" role="status">Backup creato e verificato.</p>{/if}
    {#if form?.backupError}<p class="form-error" role="alert">{form.backupError}</p>{/if}
  </section>
  <section class="settings-panel">
    <div class="panel-title"><Bot size={22} /><h2>Codex</h2></div>
    <div class="settings-row"><div><strong>Analisi assistita</strong><span>{data.codex.instructions}</span></div><span class:available={data.codex.state === "authenticated"} class="capability-state">{#if data.codex.state === "authenticated"}<ShieldCheck size={17} />{:else}<ShieldAlert size={17} />{/if}{data.codex.label}</span></div>
  </section>
</div>
