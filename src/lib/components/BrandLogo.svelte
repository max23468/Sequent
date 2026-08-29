<script lang="ts">
  let {
    compact = false,
    href = "/",
    label,
  } = $props<{ compact?: boolean; href?: string | null; label?: string }>();

  let accessibleLabel = $derived(label ?? (href === "/" ? "Sequent, Dashboard" : "Sequent"));
</script>

{#snippet brandContent()}
  <span class="brand-symbol" aria-hidden="true">
    <img class="brand-symbol-light" src="/brand/sequent-symbol.svg" alt="" />
    <img class="brand-symbol-dark" src="/brand/sequent-symbol-inverse.svg" alt="" />
  </span>
  <span>Sequent</span>
{/snippet}

{#if href}
  <a class:compact class="brand-logo" {href} aria-label={accessibleLabel}>
    {@render brandContent()}
  </a>
{:else}
  <div class:compact class="brand-logo brand-logo-static" aria-label={accessibleLabel}>
    {@render brandContent()}
  </div>
{/if}
