require('@dotenvx/dotenvx').config({ quiet: true })

const yargs = require('yargs')
const { hideBin } = require('yargs/helpers')
const esbuild = require('esbuild')

const lambdaEnvironmentSettings = {
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'node',
  packages: 'external',
  target: ['node24']
}

const cloudfrontFunctionEnvironmentSettings = {
  bundle: false,
  minify: true,
  minifyIdentifiers: false,
  platform: 'node',
  packages: 'external',
  target: ['es5'],
  supported: {
    'async-await': true
  }
}

const loadFromEnv = (...keys) => {
  const defines = {}
  for (const key of keys) {
    if (!process.env[key]) throw new Error(`Env var ${key} must be defined`)
    defines[`process.env.${key}`] = `'${process.env[key]}'`
  }
  return defines
}

function buildCli () {
  console.log('Building cli')
  esbuild.buildSync({
    entryPoints: ['src/cli/index.js'],
    bundle: true,
    define: loadFromEnv('APP_NAME', 'BIN_NAME', 'API_HOST', 'SITE_DOMAIN', 'CONFIG_NAME'),
    minify: true,
    platform: 'node',
    packages: 'external',
    target: ['node20.20'],
    outfile: 'dist/cli.js'
  })
}

function buildApi () {
  console.log('Building api lambda handler')
  esbuild.buildSync({
    ...lambdaEnvironmentSettings,
    entryPoints: ['api.handler.js'],
    outfile: 'dist/api_handler.js'
  })
}

function buildS3 () {
  console.log('Building s3 lambda handler')
  esbuild.buildSync({
    ...lambdaEnvironmentSettings,
    entryPoints: ['s3.handler.js'],
    outfile: 'dist/s3_handler.js'
  })
}

function buildEdge () {
  console.log('Building edge lambda handler')
  esbuild.buildSync({
    ...cloudfrontFunctionEnvironmentSettings,
    entryPoints: ['edge.handler.js'],
    drop: ['console'],
    define: {
      CLOUDFORMATION: 'true'
    },
    outfile: 'dist/edge_handler.js'
  })
  esbuild.buildSync({
    entryPoints: ['edge.handler.js'],
    target: ['node24'],
    drop: ['console'],
    define: {
      CLOUDFORMATION: 'false'
    },
    outfile: 'dist/edge_handler.testable.js'
  })
}

function build (command) {
  switch (command) {
    case 'all':
      ['cli', 'lambda:api', 'lambda:s3', 'lambda:edge'].forEach(c => build(c))
      break
    case 'cli': return buildCli()
    case 'lambda:api': return buildApi()
    case 'lambda:s3': return buildS3()
    case 'lambda:edge': return buildEdge()
    default:
      throw new Error(`Unknown build command ${command}`)
  }
}

function main () {
  const argv = yargs(hideBin(process.argv)).parse()
  if (argv._.length === 0) {
    build('all')
  } else {
    for (const command of argv._) {
      build(command)
    }
  }
}

main()
