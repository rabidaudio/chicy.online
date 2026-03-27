const { execSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('fs')
const path = require('node:path')

const projectRoot = __dirname

execSync('npm run build', { cwd: projectRoot })

const content = fs.readFileSync(path.join(projectRoot, 'dist/edge_handler.js')).toString('utf8')
module.exports.content = content
const hash = createHash('sha1')
hash.update(content)
module.exports.hash = hash.digest('base64url')
