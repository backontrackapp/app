import presentationDataset from '@/data/exercise-presentations.json'
import type {
  ExercisePresentation,
  ExercisePresentationDataset,
} from '@/types/exercise'

const presentationsById = new Map(
  (presentationDataset as ExercisePresentationDataset).exercises.map((exercise): [string, ExercisePresentation] => [
    exercise.id,
    {
      id: exercise.id,
      name: exercise.name,
      imageUrl: exercise.image ? `/exercises/${exercise.image}` : '',
    },
  ]),
)

export function exercisePresentationById(exerciseId?: string) {
  return exerciseId ? presentationsById.get(exerciseId) : undefined
}
