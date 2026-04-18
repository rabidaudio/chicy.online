const fs = require('node:fs/promises')
const path = require('node:path')
const { buffer } = require('node:stream/consumers')

const moment = require('moment')

const s3 = require('../s3')

const migrationsFile = 'migrations.txt' // on S3

const migrationPath = path.join(__dirname, '../../migrations') // in source code

const createMigrationId = (message) => {
  const sanitized = message.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-_]/g, '')
  if (sanitized.length === 0 || sanitized.length > 64) {
    throw new Error(`Invalid message: "${message}". Message must be non-empty ` +
            'and less than 64 characters. Non-ascii characters are sanitized (removed).')
  }
  return `${moment().format('YYYYMMDD-x')}-${sanitized}`
}

const parseMigrationId = (migrationId) => {
  const match = migrationId.match(/^[0-9]{8}-([0-9]+)-(.*)$/)
  if (!match) throw new Error(`Invalid Migration ID: ${migrationId}`)
  return { migrationId, timestamp: moment(parseInt(match[1], 10)), message: match[2] }
}

const create = async (message) => {
  const migrationId = createMigrationId(message)
  const f = path.join(migrationPath, `${migrationId}.js`)
  const template = await fs.readFile(path.join(__dirname, '_migration_template.js'))
  await fs.writeFile(f, template, { flag: 'wx' })
  return { migrationId, path: f }
}

const availableMigrations = async () => {
  const files = await Array.fromAsync(fs.glob('*.js', { cwd: migrationPath }))
  return files.map(f => f.replace(/\.js$/, ''))
}

const readMigrations = async () => {
  try {
    const data = await buffer(await s3.download(migrationsFile, { bucket: process.env.APP_BUCKET_NAME }))
    return data.toString('utf8').split('\n')
  } catch (err) {
    if (err.Code === 'NoSuchKey') return []
    throw err
  }
}

const writeMigrationState = async (completedMigrationIds) => {
  completedMigrationIds.sort()
  const file = Buffer.from(completedMigrationIds.join('\n'))
  await s3.upload(migrationsFile, file, {
    bucket: process.env.APP_BUCKET_NAME,
    contentType: 'text/plain'
  })
}

// returns a list of migrations in forward execution order.
// [{ migrationId: '20260417-1776464749832-my-migration', run: true }]
const getMigrationState = async () => {
  const available = await availableMigrations()
  available.sort()
  const completed = new Set(await readMigrations())
  return available.map(migrationId => ({
    ...parseMigrationId(migrationId),
    run: completed.has(migrationId),
    path: path.join(migrationPath, `${migrationId}.js`)
  }))
}

const listPending = async () => {
  const state = await getMigrationState()
  return state.filter(({ run }) => !run).map(({ migrationId }) => migrationId)
}

const createRunSet = (state) =>
  new Set(state.filter(({ run }) => run).map(({ migrationId }) => migrationId))

const up = async () => {
  const state = await getMigrationState()
  const runMigrations = createRunSet(state)

  const next = state.filter(({ run }) => !run).at(0)
  if (!next) throw new Error('No migrations to run')

  console.log(`UP ${next.migrationId}`)
  const migration = require(next.path)

  await migration.up()

  runMigrations.add(next.migrationId)
  writeMigrationState(Array.from(runMigrations))
}

const down = async () => {
  const state = await getMigrationState()
  const runMigrations = createRunSet(state)
  const mostRecent = state.filter(({ run }) => run).at(-1)
  if (!mostRecent) throw new Error('No migrations to roll back')

  console.log(`DOWN ${mostRecent.migrationId}`)
  const migration = require(mostRecent.path)

  await migration.down()

  runMigrations.delete(mostRecent.migrationId)
  writeMigrationState(Array.from(runMigrations))
}

const runAll = async () => {
  const pending = await listPending()
  for (const id of pending) {
    await up(id)
  }
  return pending
}

// when new environments are created, their code is already migrated, so
// we should create an initial migrations file indicating all the previous
// migrations "completed".
const initNewEnvironment = async () => {
  const available = await availableMigrations()
  await writeMigrationState(available)
}

module.exports = {
  create,
  getMigrationState,
  up,
  down,
  runAll,
  initNewEnvironment
}
