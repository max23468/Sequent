<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type { DashboardVerificationItem } from "$lib/dashboard";

  let { item }: { item: DashboardVerificationItem } = $props();
</script>

<li>
  <a href={item.href} data-sveltekit-prefetch>
    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
    <ChevronRight size={19} aria-hidden="true" />
  </a>
</li>
