const { glob } = require('node:fs/promises')
const path = require('node:path')

async function runAllTests () {
  for await (const t of glob(path.join(__dirname, '**/*.test.js'))) {
    require(t)
  }
}

runAllTests()
