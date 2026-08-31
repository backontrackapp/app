import type {
  ExerciseDataset,
  ExerciseDatasetRecord,
  ExerciseLocale,
  ExerciseOption,
  ExerciseOptionGroup,
} from '@/types/exercise'

const exerciseOptionsPromises = new Map<ExerciseLocale, Promise<ExerciseOption[]>>()
const abdominalSearchTerms = new Set(['ab', 'abs', 'abdominal', 'abdominals'])
const pectoralisSearchTerms = new Set(['chest', 'pecs'])

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
          ...primaryMuscles,
          ...secondaryMuscles,
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

  return options
    .filter(option => terms.every((term) => {
      if (option.searchText.includes(term)) return true
      if (abdominalSearchTerms.has(term)) {
        return option.bodyPart === 'core'
          || [...option.primaryMuscles, ...option.secondaryMuscles].includes('obliques')
      }
      return pectoralisSearchTerms.has(term) && hasPectoralisMuscle(option)
    }))
    .sort((first, second) => compareSearchResults(first, second, terms))
}

function compareSearchResults(first: ExerciseOption, second: ExerciseOption, terms: string[]) {
  const primaryDifference = firstMuscleSearchIndex(first.primaryMuscles, terms)
    - firstMuscleSearchIndex(second.primaryMuscles, terms)
  if (primaryDifference) return primaryDifference
  if (firstMuscleSearchIndex(first.primaryMuscles, terms) !== Number.MAX_SAFE_INTEGER) {
    return first.name.localeCompare(second.name)
  }

  const secondaryDifference = firstMuscleSearchIndex(first.secondaryMuscles, terms)
    - firstMuscleSearchIndex(second.secondaryMuscles, terms)
  if (secondaryDifference) return secondaryDifference
  if (firstMuscleSearchIndex(first.secondaryMuscles, terms) !== Number.MAX_SAFE_INTEGER) {
    return first.name.localeCompare(second.name)
  }

  const bodyPartDifference = bodyPartSearchRank(first, terms) - bodyPartSearchRank(second, terms)
  if (bodyPartDifference) return bodyPartDifference
  if (bodyPartSearchRank(first, terms) !== Number.MAX_SAFE_INTEGER) {
    return first.name.localeCompare(second.name)
  }

  const nameDifference = textSearchRank(first.name, terms) - textSearchRank(second.name, terms)
  if (nameDifference) return nameDifference
  if (textSearchRank(first.name, terms) !== Number.MAX_SAFE_INTEGER) {
    return first.name.localeCompare(second.name)
  }

  const remainingDifference = textSearchRank(`${first.category} ${first.equipment}`, terms)
    - textSearchRank(`${second.category} ${second.equipment}`, terms)
  if (remainingDifference) return remainingDifference

  return first.bodyPartLabel.localeCompare(second.bodyPartLabel)
    || first.name.localeCompare(second.name)
}

function firstMuscleSearchIndex(muscles: string[], terms: string[]) {
  const index = muscles.findIndex(muscle => (
    terms.some(term => muscleTextMatchesSearchTerm(normalizeSearchText(muscle), term))
  ))
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

function bodyPartSearchRank(option: ExerciseOption, terms: string[]) {
  if (terms.some(term => textMatchesSearchTerm(option.bodyPart, term))) return 0
  if (terms.some(term => abdominalSearchTerms.has(term) && option.bodyPart === 'core')) return 0
  return Number.MAX_SAFE_INTEGER
}

function textSearchRank(text: string, terms: string[]) {
  return terms.some(term => normalizeSearchText(text).includes(term))
    ? 0
    : Number.MAX_SAFE_INTEGER
}

function hasPectoralisMuscle(option: ExerciseOption) {
  return [...option.primaryMuscles, ...option.secondaryMuscles]
    .some(muscle => muscle.includes('pectoralis'))
}

function muscleTextMatchesSearchTerm(muscleText: string, term: string) {
  return muscleText.includes(term)
    || (pectoralisSearchTerms.has(term) && muscleText.includes('pectoralis'))
}

function textMatchesSearchTerm(text: string, term: string) {
  return normalizeSearchText(text).includes(term)
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
