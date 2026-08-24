<script lang="ts">
  import BrandLogo from "$lib/components/BrandLogo.svelte";
  let { form } = $props();
</script>

<main class="auth-page">
  <section class="auth-panel compact">
    <BrandLogo />
    <h1>Accedi</h1>
    <p>Apri la tua istanza privata.</p>
    <form method="POST">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      {#if form?.error}<p class="form-error" role="alert">{form.error}</p>{/if}
      <button class="button primary full" type="submit">Accedi</button>
    </form>
  </section>
</main>
