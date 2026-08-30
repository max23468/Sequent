<script lang="ts">
  import { Cloud, CloudOff, Download, LoaderCircle, RefreshCw, Trash2 } from "@lucide/svelte";
  import {
    discardLocalChanges,
    exportOfflineRecovery,
    isServerReachable,
    makePracticeAvailableOffline,
    readOfflineState,
    removeOfflinePractice,
    restoreQueuedFieldValues,
    synchronizeOfflinePractice,
    type OfflineState,
  } from "$lib/offline/manager";
  import type { PageData } from "../../routes/pratiche/[id]/$types";

  let { data } = $props<{ data: PageData }>();
  let offlineState = $state<OfflineState>({ pendingMutations: 0, pendingAttachments: 0 });
  let online = $state(true);
  let working = $state(false);
  let message = $state("");

  const pendingCount = $derived(
    offlineState.pendingMutations + offlineState.pendingAttachments,
  );

  async function refresh() {
    offlineState = await readOfflineState(data.practice.id);
    await restoreQueuedFieldValues(data.practice.id);
  }

  $effect(() => {
    const queueListener = () => void refresh();
    window.addEventListener("sequent:offline-queue", queueListener);
    const connectivityTimer = window.setInterval(() => {
      if (online) return;
      void isServerReachable().then(async (reachable) => {
        if (!reachable) return;
        online = true;
        await synchronize();
      });
    }, 2_000);
    void Promise.all([refresh(), isServerReachable()]).then(async ([, reachable]) => {
      online = reachable;
      if (online && pendingCount > 0 && !offlineState.conflict) await synchronize();
      else if (
        online &&
        offlineState.practice?.status === "complete" &&
        (offlineState.practice.needsRefresh ||
          offlineState.practice.baseRevision !== data.declaration.revision)
      ) {
        working = true;
        message = "Aggiornamento della copia offline…";
        try {
          await makePracticeAvailableOffline(data);
          await refresh();
          message = "Copia offline aggiornata.";
        } finally {
          working = false;
        }
      }
    });
    return () => {
      window.removeEventListener("sequent:offline-queue", queueListener);
      window.clearInterval(connectivityTimer);
    };
  });

  async function enableOffline() {
    working = true;
    message = "Preparazione della pratica in corso…";
    try {
      await makePracticeAvailableOffline(data);
      message = "Pratica disponibile offline su questo dispositivo.";
    } catch (error) {
      message =
        error instanceof Error && error.message === "OFFLINE_STORAGE_LOW"
          ? "Spazio locale insufficiente: libera spazio e riprova. Nessun dato in coda è stato eliminato."
          : "Download incompleto. La copia parziale non viene indicata come disponibile offline.";
    } finally {
      working = false;
      await refresh();
    }
  }

  async function synchronize() {
    if (!online || working || offlineState.conflict) return;
    working = true;
    const hadPendingChanges = pendingCount > 0;
    message = "Sincronizzazione delle modifiche locali…";
    try {
      const result = await synchronizeOfflinePractice(data.practice.id);
      message = result?.conflict
        ? "La pratica sul server è diversa dalla copia locale. Scegli quale versione conservare."
        : "Modifiche locali sincronizzate.";
      await refresh();
      if (!result?.conflict && hadPendingChanges) window.location.reload();
    } catch {
      message = "Sincronizzazione non riuscita. Le modifiche restano conservate sul dispositivo.";
      await refresh();
    } finally {
      working = false;
    }
  }

  async function handleOnline() {
    online = await isServerReachable();
    if (online) await synchronize();
  }

  function handleOffline() {
    online = false;
    message = "Sei offline. Le modifiche compatibili restano in coda su questo dispositivo.";
  }

  async function keepServerVersion() {
    await discardLocalChanges(data.practice.id);
    message = "Versione server conservata; modifiche locali scartate.";
    await refresh();
    window.location.reload();
  }

  async function exportLocalCopy() {
    await exportOfflineRecovery(data.practice.id);
    message = "Copia locale esportata. Potrai confrontarla e reimportarla manualmente.";
  }

  async function removeCopy() {
    if (pendingCount > 0) {
      message = "Esporta o sincronizza prima le modifiche locali: non vengono eliminate automaticamente.";
      return;
    }
    await removeOfflinePractice(data.practice.id);
    message = "Copia offline rimossa da questo dispositivo.";
    await refresh();
  }
</script>

<svelte:window ononline={handleOnline} onoffline={handleOffline} />

<section class="offline-practice-controls" aria-live="polite">
  <div class="offline-practice-status">
    {#if online}<Cloud size={18} aria-hidden="true" />{:else}<CloudOff size={18} aria-hidden="true" />{/if}
    <span>
      <strong>{online ? "Online" : "Offline"}</strong>
      <small class:pending={pendingCount > 0}>
        {#if offlineState.practice?.status === "complete"}
          Offline pronta · {offlineState.practice.downloadedDocumentCount}/{offlineState.practice.documentCount}
        {:else if offlineState.practice}
          Copia incompleta
        {:else}
          Solo server
        {/if}
        {#if pendingCount > 0} · {pendingCount} {pendingCount === 1 ? "modifica in coda" : "modifiche in coda"}{/if}
      </small>
    </span>
  </div>
  <div class="offline-practice-actions">
    {#if !offlineState.practice || offlineState.practice.status !== "complete"}
      <button class="button secondary" type="button" onclick={enableOffline} disabled={!online || working}>
        {#if working}<LoaderCircle class="spinning" size={16} />{:else}<Download size={16} />{/if}
        Scarica offline
      </button>
    {:else}
      {#if pendingCount > 0 && online && !offlineState.conflict}
        <button class="button secondary" type="button" onclick={synchronize} disabled={working}>
          <RefreshCw class={working ? "spinning" : ""} size={16} />Sincronizza ora
        </button>
      {/if}
      <button class="button text" type="button" onclick={removeCopy} disabled={working}>
        <Trash2 size={15} />Rimuovi offline
      </button>
    {/if}
  </div>
</section>

{#if offlineState.conflict}
  <section class="offline-conflict" role="alert">
    <div>
      <strong>Conflitto tra server e modifiche locali</strong>
      <p>Sequent non unisce automaticamente i campi. Puoi mantenere il server oppure esportare la copia locale per confrontarla e reimportarla manualmente.</p>
    </div>
    <div>
      <button class="button secondary" type="button" onclick={exportLocalCopy}>Esporta copia locale</button>
      <button class="button text" type="button" onclick={keepServerVersion}>Mantieni versione server</button>
    </div>
  </section>
{/if}

{#if message}<p class="offline-practice-message">{message}</p>{/if}
