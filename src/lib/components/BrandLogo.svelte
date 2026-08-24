<script lang="ts">
  let { compact = false } = $props<{ compact?: boolean }>();
</script>

<a class:compact class="brand-logo" href="/" aria-label="Sequent, Dashboard">
  <span class="brand-symbol" aria-hidden="true">
    <img class="brand-symbol-light" src="/brand/sequent-symbol.svg" alt="" />
    <img class="brand-symbol-dark" src="/brand/sequent-symbol-inverse.svg" alt="" />
  </span>
  <span>Sequent</span>
</a>
