<script lang="ts">
  import BrandLogo from "$lib/components/BrandLogo.svelte";
  let { form } = $props();
</script>

<main class="auth-page">
  <section class="auth-panel">
    <BrandLogo />
    <h1>Crea l’account proprietario</h1>
    <p>Questo è l’unico account dell’istanza. La password resta protetta sulla tua VPS.</p>
    <form method="POST">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" minlength="14" maxlength="128" autocomplete="new-password" required />
      <label for="password-confirm">Ripeti la password</label>
      <input id="password-confirm" name="passwordConfirm" type="password" minlength="14" maxlength="128" autocomplete="new-password" required />
      {#if form?.error}<p class="form-error" role="alert">{form.error}</p>{/if}
      <button class="button primary full" type="submit">Crea account</button>
    </form>
  </section>
</main>
