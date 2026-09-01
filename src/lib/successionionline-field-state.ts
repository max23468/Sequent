export const SUCCESSIONIONLINE_FIELD_STATE = Symbol("successionionline-field-state");

export interface SuccessioniOnLineFieldState {
  current(fieldId: string, persistedValue: string): string;
  update(fieldId: string, value: string): void;
}
