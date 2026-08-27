<script lang="ts">
  import { Bot, ExternalLink, Palette, ShieldAlert, ShieldCheck } from "@lucide/svelte";
  import ThemeSelector from "$lib/components/ThemeSelector.svelte";
  let { data } = $props();
</script>

<svelte:head><title>Impostazioni · Sequent</title></svelte:head>
<div class="page-frame index-page">
  <div class="page-heading"><div><h1>Impostazioni</h1><p>Preferenze locali e capacità qualificate dell’istanza.</p></div></div>
  <section class="settings-panel appearance-panel">
    <div class="panel-title"><Palette size={22} /><h2>Aspetto</h2></div>
    <div class="settings-row"><div><strong>Tema dell’interfaccia</strong><span>Segui il sistema oppure mantieni sempre il tema chiaro o scuro su questo dispositivo.</span></div><ThemeSelector /></div>
  </section>
  <section class="settings-panel">
    <div class="panel-title"><ExternalLink size={22} /><h2>Applicazioni esterne</h2></div>
    {#each data.launchers as launcher (launcher.id)}
      <div class="settings-row"><div><strong>{launcher.label}</strong><span>{launcher.instructions}</span></div><span class:available={launcher.state === "available"} class="capability-state"><ShieldCheck size={17} />{launcher.state === "available" ? "Qualificato" : "Apertura manuale"}</span></div>
    {/each}
  </section>
  <section class="settings-panel">
    <div class="panel-title"><Bot size={22} /><h2>Codex</h2></div>
    <div class="settings-row"><div><strong>Analisi assistita</strong><span>{data.codex.instructions}</span></div><span class:available={data.codex.state === "authenticated"} class="capability-state">{#if data.codex.state === "authenticated"}<ShieldCheck size={17} />{:else}<ShieldAlert size={17} />{/if}{data.codex.label}</span></div>
  </section>
</div>
