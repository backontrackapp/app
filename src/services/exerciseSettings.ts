import type { WeightUnit } from '@/types/exercise'

export const DEFAULT_EXERCISE_WEIGHT_UNIT: WeightUnit = 'kg'

export function normalizeExerciseWeightUnit(value: unknown): WeightUnit {
  return value === 'lb' ? 'lb' : DEFAULT_EXERCISE_WEIGHT_UNIT
}
