const DEFAULT_MAX_DIALOG_LENGTH = 9;
const DEFAULT_SUMMARIZING_MAX = 6;
const DEFAULT_BOTH_MAX = 13;
const DEFAULT_PRACTICE_REFUSAL_THRESHOLD = 1;
const DEFAULT_RANGE_GROUP_SIZE = 5;
const DEFAULT_LIFE_MATRIX_LOG_SMOOTHING_K = 50;
const DEFAULT_LIFE_MATRIX_OVERDEV_FACTOR = 2;
const LIFE_MATRIX_CHAKRA_COUNT = 7;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMaxDialogLength(): number {
  return parsePositiveInt(process.env.MAX_DIALOG_LENGTH, DEFAULT_MAX_DIALOG_LENGTH);
}

export function getPlanningMaxDialogLength(): number {
  return parsePositiveInt(process.env.MAX_DIALOG_PLANNING, getMaxDialogLength());
}

export function getSummarizingMaxDialogLength(): number {
  return parsePositiveInt(process.env.MAX_DIALOG_SUMMARIZING, DEFAULT_SUMMARIZING_MAX);
}

export function getBothMaxDialogLength(): number {
  return parsePositiveInt(process.env.MAX_DIALOG_BOTH, DEFAULT_BOTH_MAX);
}

export function getPracticeRefusalThreshold(): number {
  return parsePositiveInt(process.env.PRACTICE_REFUSAL_THRESHOLD, DEFAULT_PRACTICE_REFUSAL_THRESHOLD);
}

export function getRangeGroupSize(): number {
  return parsePositiveInt(process.env.RANGE_GROUP_SIZE, DEFAULT_RANGE_GROUP_SIZE);
}

export function getLifeMatrixLogSmoothingK(): number {
  return parsePositiveNumber(process.env.LIFE_MATRIX_LOG_SMOOTHING_K, DEFAULT_LIFE_MATRIX_LOG_SMOOTHING_K);
}

export function getLifeMatrixOverdevFactor(): number {
  return parsePositiveNumber(process.env.LIFE_MATRIX_OVERDEV_FACTOR, DEFAULT_LIFE_MATRIX_OVERDEV_FACTOR);
}

export function getLifeMatrixOverdevThreshold(): number {
  return getLifeMatrixOverdevFactor() / LIFE_MATRIX_CHAKRA_COUNT;
}
