const DEFAULT_MAX_DIALOG_LENGTH = 9;

export function getMaxDialogLength(): number {
  const value = Number.parseInt(process.env.MAX_DIALOG_LENGTH ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_DIALOG_LENGTH;
}
