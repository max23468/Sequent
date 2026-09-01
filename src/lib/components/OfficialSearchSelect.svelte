<script lang="ts">
  import { untrack } from "svelte";
  import {
    loadOfficialChoiceOptions,
    type OfficialChoiceOption,
  } from "$lib/client/official-options";

  let {
    id,
    fieldId,
    name,
    value,
    provinceFieldId = null,
    provinceValue = "",
    disabled = false,
    ariaLabel,
    ariaDescribedby = undefined,
  } = $props<{
    id: string;
    fieldId: string;
    name: string;
    value: string;
    provinceFieldId?: string | null;
    provinceValue?: string;
    disabled?: boolean;
    ariaLabel: string;
    ariaDescribedby?: string;
  }>();

  let root: HTMLDivElement | undefined = undefined;
  let input: HTMLInputElement | undefined = undefined;
  let query = $state(untrack(() => value));
  let selectedValue = $state(untrack(() => value));
  let options = $state<OfficialChoiceOption[]>([]);
  let open = $state(false);
  let loading = $state(false);
  let activeIndex = $state(-1);
  let requestNumber = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const listId = untrack(() => `${id}-choices`);

  function selectedProvinceValue(): string {
    const form = root?.closest("form");
    if (!form || !provinceFieldId) return provinceValue;
    return String(new FormData(form).get(`value:${provinceFieldId}`) ?? provinceValue);
  }

  function updateValidity(): void {
    input?.setCustomValidity(
      query.trim() !== "" && selectedValue === ""
        ? "Seleziona una voce dall’elenco ufficiale."
        : "",
    );
  }

  async function loadOptions(search = query): Promise<void> {
    const currentRequest = ++requestNumber;
    loading = true;
    const parameters = new URLSearchParams({ fieldId, query: search.trim() });
    const province = selectedProvinceValue();
    if (province) parameters.set("province", province);
    try {
      const loadedOptions = await loadOfficialChoiceOptions(parameters);
      if (currentRequest !== requestNumber) return;
      options = loadedOptions;
      activeIndex = options.length > 0 ? 0 : -1;
      open = true;
    } catch {
      if (currentRequest !== requestNumber) return;
      options = [];
      activeIndex = -1;
      open = true;
    } finally {
      if (currentRequest === requestNumber) loading = false;
    }
  }

  function handleFocus(): void {
    void loadOptions("");
  }

  function handleInput(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value;
    if (query !== selectedValue) selectedValue = "";
    updateValidity();
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void loadOptions(), 140);
  }

  function choose(option: OfficialChoiceOption): void {
    selectedValue = option.value;
    query = option.label;
    open = false;
    updateValidity();
    input?.focus();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) void loadOptions();
      else activeIndex = Math.min(activeIndex + 1, options.length - 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
      return;
    }
    if (event.key === "Escape") open = false;
  }

  function handleBlur(): void {
    setTimeout(() => {
      if (!root?.contains(document.activeElement)) open = false;
    }, 0);
  }

  function preventOptionBlur(event: MouseEvent): void {
    event.preventDefault();
  }

  function handleOptionClick(event: MouseEvent): void {
    const index = Number((event.currentTarget as HTMLButtonElement).dataset.index);
    const option = options[index];
    if (option) choose(option);
  }
</script>

<div class="official-search-select" bind:this={root}>
  <input type="hidden" {name} value={selectedValue} {disabled} />
  <input
    bind:this={input}
    {id}
    type="search"
    value={query}
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listId}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedby}
    aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
    autocomplete="off"
    {disabled}
    onfocus={handleFocus}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onblur={handleBlur}
  />
  {#if open}
    <div class="official-search-results" id={listId} role="listbox">
      {#if loading}
        <p role="status">Ricerca nell’elenco ufficiale…</p>
      {:else if options.length === 0}
        <p role="status">Nessuna voce corrispondente.</p>
      {:else}
        {#each options as option, index (`${option.value}:${option.label}`)}
          <button
            id={`${listId}-${index}`}
            type="button"
            role="option"
            data-index={index}
            aria-selected={index === activeIndex}
            class:active={index === activeIndex}
            onmousedown={preventOptionBlur}
            onclick={handleOptionClick}
          >{option.label}</button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
