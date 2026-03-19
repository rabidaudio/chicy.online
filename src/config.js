const { existsSync } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')

const CONFIG_NAME = '.chicy.json'

class ConfigValidationError extends Error {}

const sanitizeStringArray = (name, value) => {
  if (!value) {
    return []
  } else if (typeof value === 'string') {
    return [value]
  }
  if (value instanceof Array) {
    if (value.length === 0 || typeof value[0] === 'string') {
      return value
    }
  }
  throw new ConfigValidationError(`Expected config \`${name}\` to be an array of strings but found \`${value}\``)
}

const generateDefaultConfig = () => sanitize({})

const generateCommonConfig = () => sanitize({
  headers: {},
  errorPages: {
    404: '404.html'
  },
  rewriteRules: {
    /* eslint-disable-next-line no-template-curly-in-string */
    '^(.*)/$': '${1}/index.html',
    /* eslint-disable-next-line no-template-curly-in-string */
    '^(.*)/([^.]+)$': '${1}/${2}/index.html'
  }
})

const sanitize = (config) => {
  let { exclude, retain, headers, errorPages, rewriteRules } = config
  exclude = sanitizeStringArray('exclude', exclude)
  retain = sanitizeStringArray('exclude', retain)
  headers ||= {}
  for (const [key, val] of Object.entries(headers)) {
    if (typeof key !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages\` to have string keys but found \`${key}\``) }
    if (typeof val !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages.${key}\` to be a string but found \`${val}\``) }
  }
  errorPages ||= {}
  for (const [key, val] of Object.entries(errorPages)) {
    if (!key.match(/([0-9]{3}|[0-9]{3}-[0-9]{3})/)) { throw new ConfigValidationError(`Expected config \`errorPages\` keys to be status code ranges but found \`${key}\``) }
    if (typeof val !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages.${key}\` to be a string but found \`${val}\``) }
  }
  rewriteRules ||= {}
  for (const [key, val] of Object.entries(rewriteRules)) {
    try { RegExp.call(key) } catch (err) { throw new ConfigValidationError('Invalid regex in `rewriteRules`', { cause: err }) }

    if (typeof val !== 'string') { throw new ConfigValidationError(`Expected config \`rewriteRules.${key}\` to be a string but found \`${val}\``) }
  }
  return {
    exclude,
    retain,
    headers,
    errorPages,
    rewriteRules
  }
}

const findConfig = async (confPath = null) => {
  confPath ||= process.cwd()
  if (existsSync(confPath) && (await fs.stat(confPath)).isDirectory()) {
    confPath = path.join(confPath, CONFIG_NAME)
  }
  if (!existsSync(confPath) || !(await fs.stat(confPath)).isFile()) {
    return null
  }
  const data = await fs.readFile(confPath)
  let conf
  try {
    conf = JSON.parse(data)
  } catch (err) {
    throw new ConfigValidationError('Invalid JSON in config file', { cause: err })
  }
  return sanitize(conf)
}

const saveCommonConfig = async (dir = process.cwd()) => {
  const fullPath = path.join(dir, CONFIG_NAME)
  if (existsSync(fullPath)) {
    return null
  }
  fs.writeFile(fullPath, JSON.stringify(generateCommonConfig(), null, 2))
  return path.relative(process.cwd(), fullPath)
}

module.exports = {
  findConfig,
  generateDefaultConfig,
  saveCommonConfig
}
