import { readFile, writeFile } from 'node:fs/promises'

const sourceUrl = new URL('../src/data/exercises.json', import.meta.url)
const outputUrl = new URL('../src/data/exercise-presentations.json', import.meta.url)
const source = JSON.parse(await readFile(sourceUrl, 'utf8'))
const exercises = source.exercises.map((exercise) => ({
  id: exercise.id,
  name: exercise.name_en,
  image: exercise.images.flat.main
    || exercise.images.flat.start
    || exercise.images.flat.peak
    || '',
}))

await writeFile(outputUrl, `${JSON.stringify({
  schemaVersion: source.schema_version,
  count: exercises.length,
  exercises,
}, null, 2)}\n`)
