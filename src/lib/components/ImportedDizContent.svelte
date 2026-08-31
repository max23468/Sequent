<script lang="ts">
  import { Archive, ChevronDown, FileArchive } from "@lucide/svelte";
  import type { ImportedDizContent } from "$lib/server/official-flow";

  let { content } = $props<{ content: ImportedDizContent }>();
</script>

<section class="imported-diz-card" aria-labelledby="imported-diz-heading">
  <header>
    <span class="imported-diz-icon"><Archive size={21} /></span>
    <div>
      <h2 id="imported-diz-heading">Contenuto acquisito dal DIZ</h2>
      <p>{content.fieldCount} valori originali consultabili in sola lettura</p>
    </div>
  </header>

  <div class="imported-diz-summary">
    <div><span>Valori nel DIZ</span><strong>{content.fieldCount}</strong></div>
    <div><span>Integrati nei campi</span><strong>{content.integratedFields}</strong></div>
    <div><span>Conservati nell’originale</span><strong>{content.preservedFields}</strong></div>
    <div><span>Allegati incorporati</span><strong>{content.attachments.length}</strong></div>
  </div>

  <p class="imported-diz-note">
    I valori riconosciuti dalle proprietà ufficiali di SuccessioniOnLine sono integrati nei relativi
    soggetti, beni e posizioni. I valori storici o opachi senza destinazione nello schema corrente
    restano visibili qui e invariati nel file originale.
  </p>

  <details class="imported-diz-fields">
    <summary><ChevronDown size={17} />Consulta i valori originali</summary>
    {#each content.sections as group (group.quadro)}
      <section>
        <h3>Quadro {group.quadro} <span>{group.fields.length}</span></h3>
        <div class="imported-diz-table-wrap">
          <table>
            <thead><tr><th>Posizione</th><th>Codice</th><th>Valore originale</th></tr></thead>
            <tbody>
              {#each group.fields as field (`${field.quadro}-${field.module}-${field.field}`)}
                <tr><td>{field.module}</td><td><code>{field.field}</code></td><td>{field.value}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  </details>

  <div class="imported-diz-attachments">
    <FileArchive size={18} />
    {#if content.attachmentEvidence.status === "none-in-source"}
      <span>L’archivio DIZ originale non contiene file incorporati. Eventuali documenti consegnati separatamente devono essere caricati nella sezione Documenti.</span>
    {:else}
      <span>{content.attachments.length} allegati incorporati sono disponibili anche nella sezione Documenti.</span>
    {/if}
  </div>
</section>

<style>
  .imported-diz-card { display: grid; gap: 1rem; padding: 1.25rem; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
  header { display: flex; align-items: center; gap: .8rem; }
  header h2, header p, h3 { margin: 0; }
  header p, .imported-diz-note, .imported-diz-attachments { color: var(--muted); }
  .imported-diz-icon { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .75rem; color: var(--teal); background: var(--surface-soft); }
  .imported-diz-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .7rem; }
  .imported-diz-summary div { display: grid; gap: .2rem; padding: .8rem; border-radius: .7rem; background: var(--surface-soft); }
  .imported-diz-summary span { color: var(--muted); font-size: .8rem; }
  .imported-diz-summary strong { font-size: 1.15rem; }
  .imported-diz-note { margin: 0; line-height: 1.5; }
  summary { display: flex; align-items: center; gap: .45rem; cursor: pointer; font-weight: 700; }
  .imported-diz-fields { border-top: 1px solid var(--line); padding-top: 1rem; }
  .imported-diz-fields section { margin-top: 1rem; }
  h3 { display: flex; gap: .5rem; align-items: baseline; font-size: 1rem; }
  h3 span { color: var(--muted); font-size: .8rem; font-weight: 500; }
  .imported-diz-table-wrap { margin-top: .55rem; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { padding: .55rem .65rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .03em; }
  td:last-child { min-width: 16rem; overflow-wrap: anywhere; }
  .imported-diz-attachments { display: flex; align-items: center; gap: .5rem; }
  @media (max-width: 760px) { .imported-diz-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
