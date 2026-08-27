<script lang="ts">
  import type { PageData } from "../../routes/pratiche/[id]/$types";

  type Asset = PageData["assets"][number];
  type Scenario = PageData["devolutionScenarios"][number] | null;

  let { data, asset, scenario, kindLabel } = $props<{
    data: PageData;
    asset: Asset;
    scenario: Scenario;
    kindLabel: string;
  }>();

  function money(value: string | bigint): string {
    const cents = BigInt(value);
    const absolute = cents < 0n ? -cents : cents;
    const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${cents < 0n ? "−" : ""}${euros},${(absolute % 100n).toString().padStart(2, "0")} €`;
  }

  function centsInput(value: string | bigint): string {
    const cents = BigInt(value);
    const absolute = cents < 0n ? -cents : cents;
    return `${cents < 0n ? "-" : ""}${absolute / 100n},${(absolute % 100n).toString().padStart(2, "0")}`;
  }

  function shareValue(
    beneficiaryId: string,
    key:
      | "numerator"
      | "denominator"
      | "rightCode"
      | "reliefCode"
      | "reductionYears"
      | "previousSuccessionValueCents"
      | "foreignTaxCents",
  ): string {
    const share = scenario?.shares.find(
      (candidate: { assetId?: string; beneficiaryId: string }) =>
        candidate.assetId === asset.id && candidate.beneficiaryId === beneficiaryId,
    );
    if (!share) return key === "denominator" ? "1" : key === "rightCode" ? "1" : "";
    const value = share[key];
    if (key === "previousSuccessionValueCents" || key === "foreignTaxCents")
      return value ? centsInput(String(value)) : "";
    return String(value ?? "");
  }
</script>

<section class="devolution-asset">
  <header><div><strong>{asset.displayName}</strong><span>{kindLabel} · {money(asset.valueCents)}</span></div><small>Le quote devono sommare a 1</small></header>
  {#each data.subjects.filter((subject: { role: string }) => subject.role !== "decedent") as beneficiary (beneficiary.id)}
    {@const prefix = `share:${asset.id}:${beneficiary.id}`}
    <div class="devolution-beneficiary">
      <strong>{beneficiary.displayName}</strong>
      <label><span>Numeratore</span><input name={`${prefix}:numerator`} inputmode="numeric" value={shareValue(beneficiary.id, "numerator")} /></label>
      <label><span>Denominatore</span><input name={`${prefix}:denominator`} inputmode="numeric" value={shareValue(beneficiary.id, "denominator")} /></label>
      <label><span>Codice diritto</span><input name={`${prefix}:rightCode`} value={shareValue(beneficiary.id, "rightCode")} /></label>
      <label><span>Agevolazione</span><input name={`${prefix}:reliefCode`} maxlength="1" value={shareValue(beneficiary.id, "reliefCode")} /></label>
      <label><span>Riduzione entro 5 anni</span><select name={`${prefix}:reductionYears`}><option value="">Nessuna</option><option value="1" selected={shareValue(beneficiary.id, "reductionYears") === "1"}>1 anno</option><option value="2" selected={shareValue(beneficiary.id, "reductionYears") === "2"}>2 anni</option><option value="3" selected={shareValue(beneficiary.id, "reductionYears") === "3"}>3 anni</option><option value="4" selected={shareValue(beneficiary.id, "reductionYears") === "4"}>4 anni</option><option value="5" selected={shareValue(beneficiary.id, "reductionYears") === "5"}>5 anni</option></select></label>
      <label><span>Valore precedente</span><input name={`${prefix}:previousValue`} inputmode="decimal" value={shareValue(beneficiary.id, "previousSuccessionValueCents")} /></label>
      <label><span>Imposta pagata all’estero</span><input name={`${prefix}:foreignTax`} inputmode="decimal" value={shareValue(beneficiary.id, "foreignTaxCents")} /></label>
    </div>
  {/each}
</section>
