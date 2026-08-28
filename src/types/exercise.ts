export type ExerciseLocale = 'en' | 'de' | 'es'

export interface ExerciseImageVariants {
  main?: string
  start?: string
  peak?: string
}

export interface ExerciseDatasetRecord {
  id: string
  name_en: string
  name_de: string
  name_es: string
  description_en: string
  description_de: string
  description_es: string
  category: string
  difficulty: string
  equipment?: string
  body_part: string
  primary_muscles: string[]
  secondary_muscles: string[] | null
  images: {
    flat: ExerciseImageVariants
  }
}

export interface ExerciseDataset {
  schema_version: number
  count: number
  exercises: ExerciseDatasetRecord[]
}

export interface ExerciseOption {
  id: string
  name: string
  description: string
  category: string
  categoryLabel: string
  difficulty: string
  difficultyLabel: string
  equipment: string
  bodyPart: string
  bodyPartLabel: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
  imageUrl: string
  searchText: string
}

export interface ExerciseOptionGroup {
  bodyPart: string
  label: string
  exercises: ExerciseOption[]
}
