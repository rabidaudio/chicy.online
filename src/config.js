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
  accessControlAllowOrigin: null,
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
  let {
    exclude, skipClean, errorPages,
    accessControlAllowOrigin, rewriteRules
  } = config
  exclude = sanitizeStringArray('exclude', exclude)
  skipClean = sanitizeStringArray('exclude', skipClean)
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
    skipClean,
    errorPages,
    accessControlAllowOrigin
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

const createPathRewriter = (config) => {
  const matchers = Object.entries(config.rewriteRules).map(([k, v]) => [new RegExp(k), v])

  return (path) => {
    for (const [matcher, replacement] of matchers) {
      const matches = path.match(matcher)
      if (!matches) continue
      path = replacement
      for (let i = 0; i < matches.length; i++) {
        path = path.replaceAll('${' + i.toString() + '}', matches[i])
      }
    }
    return path
  }
}

module.exports = {
  findConfig,
  generateDefaultConfig,
  saveCommonConfig,
  createPathRewriter
}
