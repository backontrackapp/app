import type {
  ExerciseDataset,
  ExerciseDatasetRecord,
  ExerciseLocale,
  ExerciseOption,
  ExerciseOptionGroup,
} from '@/types/exercise'

const exerciseOptionsPromises = new Map<ExerciseLocale, Promise<ExerciseOption[]>>()

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatExerciseTerm(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\p{Ll}/gu, character => character.toLocaleUpperCase())
}

function localizedValue(
  exercise: ExerciseDatasetRecord,
  field: 'name' | 'description',
  locale: ExerciseLocale,
) {
  const value = exercise[`${field}_${locale}` as keyof ExerciseDatasetRecord]
  if (typeof value === 'string' && value) return value
  return exercise[`${field}_en`]
}

function localizedList(
  exercise: ExerciseDatasetRecord,
  field: 'instructions' | 'tips',
  locale: ExerciseLocale,
) {
  const value = exercise[`${field}_${locale}` as keyof ExerciseDatasetRecord]
  if (Array.isArray(value) && value.length) return value
  return exercise[`${field}_en`]
}

function exerciseImageUrls(exercise: ExerciseDatasetRecord) {
  const { main, start, peak } = exercise.images.flat
  return {
    ...(main ? { main: `/exercises/${main}` } : {}),
    ...(start ? { start: `/exercises/${start}` } : {}),
    ...(peak ? { peak: `/exercises/${peak}` } : {}),
  }
}

function exerciseImageUrl(exercise: ExerciseDatasetRecord) {
  const image = exercise.images.flat.main
    || exercise.images.flat.start
    || exercise.images.flat.peak
  return image ? `/exercises/${image}` : ''
}

export function buildExerciseOptions(
  records: ExerciseDatasetRecord[],
  locale: ExerciseLocale = 'en',
) {
  return records
    .map((exercise): ExerciseOption => {
      const name = localizedValue(exercise, 'name', locale)
      const description = localizedValue(exercise, 'description', locale)
      const categoryLabel = formatExerciseTerm(exercise.category)
      const difficultyLabel = formatExerciseTerm(exercise.difficulty)
      const equipment = exercise.equipment || ''
      const bodyPartLabel = formatExerciseTerm(exercise.body_part)
      const primaryMuscles = exercise.primary_muscles || []
      const secondaryMuscles = exercise.secondary_muscles || []
      const imageUrls = exerciseImageUrls(exercise)

      return {
        id: exercise.id,
        name,
        description,
        category: exercise.category,
        categoryLabel,
        difficulty: exercise.difficulty,
        difficultyLabel,
        equipment,
        bodyPart: exercise.body_part,
        bodyPartLabel,
        primaryMuscles,
        secondaryMuscles,
        imageUrl: exerciseImageUrl(exercise),
        imageUrls,
        instructions: localizedList(exercise, 'instructions', locale),
        tips: localizedList(exercise, 'tips', locale),
        searchText: normalizeSearchText([
          exercise.category,
          equipment,
          exercise.body_part,
          name,
        ].join(' ')),
      }
    })
    .sort((first, second) => (
      first.bodyPartLabel.localeCompare(second.bodyPartLabel, locale)
      || first.name.localeCompare(second.name, locale)
    ))
}

export function filterExerciseOptions(options: ExerciseOption[], query: string) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!terms.length) return options

  return options.filter(option => terms.every(term => option.searchText.includes(term)))
}

export function groupExerciseOptions(options: ExerciseOption[]) {
  return options.reduce<ExerciseOptionGroup[]>((groups, exercise) => {
    const current = groups.at(-1)
    if (current?.bodyPart === exercise.bodyPart) {
      current.exercises.push(exercise)
    } else {
      groups.push({
        bodyPart: exercise.bodyPart,
        label: exercise.bodyPartLabel,
        exercises: [exercise],
      })
    }
    return groups
  }, [])
}

export function loadExerciseOptions(locale: ExerciseLocale = 'en') {
  const existing = exerciseOptionsPromises.get(locale)
  if (existing) return existing

  const request = import('@/data/exercises.json')
    .then(module => buildExerciseOptions((module.default as ExerciseDataset).exercises, locale))
    .catch((error) => {
      exerciseOptionsPromises.delete(locale)
      throw error
    })
  exerciseOptionsPromises.set(locale, request)
  return request
}
