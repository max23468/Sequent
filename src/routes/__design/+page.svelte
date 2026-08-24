<script lang="ts">
  import { CalendarClock, ChevronRight, ExternalLink, FileCheck2, FileText, History, House, Plus, RotateCcw, Upload, UserRound } from "@lucide/svelte";

  const checks = [
    { id: "PR-2026-048", item: "Documento d’identità mancante", source: "Documento · p. 1", updated: "24 ago 2026", icon: UserRound },
    { id: "PR-2026-047", item: "Atto di morte da verificare", source: "Allegato · p. 2", updated: "23 ago 2026", icon: FileText },
    { id: "PR-2026-046", item: "Visura catastale da aggiornare", source: "Documento · p. 3", updated: "22 ago 2026", icon: House },
    { id: "PR-2026-045", item: "Dati anagrafici incompleti", source: "Documento · p. 1", updated: "21 ago 2026", icon: UserRound },
    { id: "PR-2026-044", item: "Documento di reddito non valido", source: "Allegato · p. 4", updated: "20 ago 2026", icon: FileText },
  ];

  const deadlines = [
    ["PR-2026-048", "Termine raccolta documenti", "30 ago 2026", "tra 6 giorni"],
    ["PR-2026-047", "Bozza dichiarazione", "10 set 2026", "tra 17 giorni"],
    ["PR-2026-046", "Invio dichiarazione", "20 set 2026", "tra 27 giorni"],
    ["PR-2026-045", "Firma documenti", "25 set 2026", "tra 32 giorni"],
    ["PR-2026-044", "Pagamento bollo", "02 ott 2026", "tra 39 giorni"],
  ];

  const practices = [
    ["PR-2026-048", "Rossi Mario", "In raccolta documenti", "Carica i documenti richiesti", "24 ago 2026"],
    ["PR-2026-047", "Bianchi Anna", "Bozza in preparazione", "Verifica e completa la bozza", "23 ago 2026"],
    ["PR-2026-046", "Verdi Luigi", "In verifica", "Controllo dei documenti", "22 ago 2026"],
    ["PR-2026-045", "Esposito Sara", "In attesa firma", "Invia per firma", "21 ago 2026"],
    ["PR-2026-044", "Romano Paolo", "Pagamento in attesa", "Effettua il pagamento bollo", "20 ago 2026"],
    ["PR-2026-043", "Conti Laura", "Completata", "Archivia pratica", "19 ago 2026"],
  ];
</script>

<svelte:head><title>Design lab · Sequent</title><meta name="robots" content="noindex" /></svelte:head>
<div class="page-frame design-lab">
  <div class="design-lab-notice"><strong>Design lab M2</strong><span>Dati sintetici · solo sviluppo e test</span></div>
  <div class="dashboard-heading">
    <h1>Dashboard</h1>
    <div class="desktop-quick-actions" aria-label="Azioni prototipo Dashboard">
      <a class="action-link" href="/impostazioni" data-sveltekit-prefetch><ExternalLink size={18} />Desktop Telematico</a>
      <a class="action-link" href="/impostazioni" data-sveltekit-prefetch><ExternalLink size={18} />SuccessioniOnLine</a>
      <a class="action-link" href="/" data-sveltekit-prefetch><RotateCcw size={19} />Riprendi ultima pratica</a>
      <a class="button secondary" href="/" data-sveltekit-prefetch><Upload size={18} />Carica documenti</a>
      <a class="button primary" href="/" data-sveltekit-prefetch><Plus size={20} />Nuova pratica</a>
    </div>
  </div>
  <div class="dashboard-grid">
    <section class="dashboard-panel attention-panel">
      <div class="panel-title"><FileCheck2 size={22} /><h2>Da verificare</h2></div>
      <div class="lab-table lab-checks">
        <div class="lab-table-head"><span>Pratica</span><span>Elemento</span><span>Origine</span><span>Aggiornato</span></div>
        {#each checks as check (check.id)}
          {@const Icon = check.icon}
          <div class="lab-table-row"><i aria-hidden="true"></i><Icon size={18} /><strong>{check.id}</strong><span>{check.item}</span><span>{check.source}</span><small>{check.updated}</small></div>
        {/each}
      </div>
      <a class="lab-see-all" href="/" data-sveltekit-prefetch><span>Vedi tutte</span><ChevronRight size={18} /></a>
    </section>
    <section class="dashboard-panel deadlines-panel">
      <div class="panel-title"><CalendarClock size={22} /><h2>Scadenze</h2></div>
      <div class="lab-table lab-deadlines">
        <div class="lab-table-head"><span>Pratica</span><span>Attività</span><span>Scadenza</span><span>Tempo residuo</span></div>
        {#each deadlines as deadline (deadline[0])}
          <div class="lab-table-row"><CalendarClock size={18} /><strong>{deadline[0]}</strong><span>{deadline[1]}</span><span>{deadline[2]}</span><small>{deadline[3]}</small></div>
        {/each}
      </div>
      <a class="lab-see-all" href="/" data-sveltekit-prefetch><span>Vedi tutte</span><ChevronRight size={18} /></a>
    </section>
    <section class="dashboard-panel recent-panel">
      <div class="panel-title"><History size={22} /><h2>Pratiche recenti</h2></div>
      <div class="responsive-table lab-recent-table">
        <div class="table-row table-header"><span>Pratica</span><span>Defunto</span><span>Stato</span><span>Prossimo passo</span><span>Aggiornato</span><span></span></div>
        {#each practices as practice (practice[0])}
          <a class="table-row practice-row" href="/" data-sveltekit-prefetch><strong>{practice[0]}</strong><span>{practice[1]}</span><span class="status-cell"><i></i>{practice[2]}</span><span>{practice[3]}</span><span>{practice[4]}</span><ChevronRight size={19} /></a>
        {/each}
      </div>
      <a class="lab-see-all" href="/" data-sveltekit-prefetch><span>Vedi tutte</span><ChevronRight size={18} /></a>
    </section>
  </div>
</div>
