const { execSync } = require('node:child_process')
const fs = require('fs')
const path = require('node:path')

const projectRoot = __dirname

execSync('npm run build', { cwd: projectRoot })
module.exports.content = fs.readFileSync(path.join(projectRoot, 'dist/edge_handler.js')).toString('utf8')
