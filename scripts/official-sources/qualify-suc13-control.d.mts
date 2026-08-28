export interface Suc13Diagnostic {
  severity: string;
  code: string;
  field: string | null;
  declarationId: string;
}

export function parseDgn(content: string): {
  version: string | null;
  releaseDate: string | null;
  diagnostics: Suc13Diagnostic[];
  blockingDiagnostics: Suc13Diagnostic[];
  advisoryDiagnostics: Suc13Diagnostic[];
};
