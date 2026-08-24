<script lang="ts">
  let { data, form } = $props();
  let creating = $state(false);

  function showCreateForm() {
    creating = true;
  }

  function hideCreateForm() {
    creating = false;
  }
</script>

<div class="workspace">
  <section class="practice-area" aria-labelledby="practices-title">
    <div class="workspace-heading">
      <h1 id="practices-title">Le tue pratiche</h1>
      <div class="workspace-actions">
        <button class="primary-button" type="button" onclick={showCreateForm}>+ Crea pratica</button>
        <button class="secondary-button" type="button" disabled title="Disponibile nel flusso DIZ qualificato">
          Importa DIZ
        </button>
      </div>
    </div>

    {#if creating}
      <form class="create-form" method="POST" action="?/create">
        <label for="practice-title">Nome della pratica</label>
        <div class="form-row">
          <input id="practice-title" name="title" maxlength="120" required />
          <button class="primary-button" type="submit">Salva</button>
          <button class="text-button" type="button" onclick={hideCreateForm}>Annulla</button>
        </div>
        {#if form?.createError}<p class="form-error">{form.createError}</p>{/if}
      </form>
    {/if}

    {#if data.practices.length === 0}
      <div class="empty-state">
        <div class="document-mark" aria-hidden="true">≡</div>
        <p>Non ci sono ancora pratiche.</p>
        <span>Crea la prima pratica oppure importa un file DIZ qualificato.</span>
      </div>
    {:else}
      <ul class="practice-list">
        {#each data.practices as practice (practice.id)}
          <li>
            <div>
              <strong>{practice.title}</strong>
              <span>Revisione {practice.revision}</span>
            </div>
            <time datetime={practice.updatedAt}>{new Date(practice.updatedAt).toLocaleDateString("it-IT")}</time>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <aside class="system-rail" aria-labelledby="system-title">
    <h2 id="system-title"><span aria-hidden="true">▤</span> Sistema</h2>
    <div class="system-row ready"><span aria-hidden="true">✓</span><p>Archivio pronto</p></div>
    <div class="system-row warning"><span aria-hidden="true">!</span><p>Backup non ancora eseguito</p></div>
    <div class="system-row"><span aria-hidden="true">◷</span><p>{data.activeJobs ? `${data.activeJobs} attività in corso` : "Nessuna attività in corso"}</p></div>
  </aside>
</div>
