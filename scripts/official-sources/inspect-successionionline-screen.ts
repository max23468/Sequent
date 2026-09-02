import { QUADRI, type QuadroId } from "../../src/domain/official-catalog/catalog.ts";
import { listSuccessioniOnLineScreenFields } from "../../src/domain/successionionline-screen-model.ts";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const quadroArgument = argument("--quadro");
if (!quadroArgument || !QUADRI.includes(quadroArgument as QuadroId))
  throw new Error(`Indicare --quadro con uno tra: ${QUADRI.join(", ")}.`);

const quadro = quadroArgument as QuadroId;
const fields = listSuccessioniOnLineScreenFields(quadro);
const count = (predicate: (field: (typeof fields)[number]) => boolean) =>
  fields.filter(predicate).length;

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      source: "SuccessioniOnLine SUC13 2.3.1 + XSD e catalogo ufficiale Sequent",
      quadro,
      counts: {
        fields: fields.length,
        direct: count(({ alignment }) => alignment.screenComparison.startsWith("direct-")),
        differentWorkflow: count(({ alignment }) =>
          alignment.screenComparison.startsWith("different-"),
        ),
        notObservedInScript: count(
          ({ alignment }) => alignment.screenComparison === "not-observed-in-script",
        ),
        required: count(({ specification }) => specification.presence === "required"),
        conditional: count(({ specification }) =>
          ["choice-dependent", "required-when-context-active"].includes(specification.presence),
        ),
        dependencies: count(({ behavior }) => behavior.disabledWhen.length > 0),
        directEquivalent: count(({ alignment }) => alignment.review === "direct-equivalent"),
        qualifiedDifferentWorkflow: count(
          ({ alignment }) => alignment.review === "qualified-different-workflow",
        ),
        qualifiedNoninteractive: count(
          ({ alignment }) => alignment.review === "qualified-noninteractive",
        ),
        qualifiedOffscreenInput: count(
          ({ alignment }) => alignment.review === "qualified-offscreen-input",
        ),
        unresolved: count(({ alignment }) => alignment.review === "unresolved"),
      },
      fields,
    },
    null,
    2,
  ),
);
