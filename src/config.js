const { existsSync } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')

const CONFIG_NAME = process.env.CONFIG_NAME || '.chicy.json'

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
  rewriteRules: [
    { match: '^$', replace: '/index.html', last: true },
    /* eslint-disable-next-line no-template-curly-in-string */
    // { match: '^(.*?)/$', replace: '${1}/index.html', last: true },
    /* eslint-disable-next-line no-template-curly-in-string */
    // { match: '^(.*?)/([^.]+)$', replace: '${1}/${2}/index.html', last: true }
  ]
})

const sanitize = (config) => {
  let { exclude, retain, headers, rewriteRules } = config
  exclude ||= []
  retain ||= []
  exclude = sanitizeStringArray('exclude', exclude)
  retain = sanitizeStringArray('exclude', retain)
  headers ||= {}
  for (const [key, val] of Object.entries(headers)) {
    if (typeof key !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages\` to have string keys but found \`${key}\``) }
    if (typeof val !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages.${key}\` to be a string but found \`${val}\``) }
  }
  // errorPages ||= {}
  // for (const [key, val] of Object.entries(errorPages)) {
  //   if (!key.match(/([0-9]{3}|[0-9]{3}-[0-9]{3})/)) { throw new ConfigValidationError(`Expected config \`errorPages\` keys to be status code ranges but found \`${key}\``) }
  //   if (typeof val !== 'string') { throw new ConfigValidationError(`Expected config \`errorPages.${key}\` to be a string but found \`${val}\``) }
  // }
  rewriteRules ||= []
  rewriteRules.forEach(rule => {
    const { match, replace } = rule
    try { RegExp.call(match) } catch (err) { throw new ConfigValidationError('Invalid regex in `rewriteRules`', { cause: err }) }

    if (typeof replace !== 'string') { throw new ConfigValidationError(`Expected config \`rewriteRules.${match}\` to be a string but found \`${replace}\``) }
    rule.last = !!rule.last
    rule.flags ||= ''
  })

  // TODO: verify rules won't crash by running a few samples through them

  return {
    exclude,
    retain,
    headers,
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
  await fs.writeFile(fullPath, JSON.stringify(generateCommonConfig(), null, 2))
  return path.relative(process.cwd(), fullPath)
}

module.exports = {
  CONFIG_NAME,
  ConfigValidationError,
  sanitize,
  findConfig,
  generateDefaultConfig,
  saveCommonConfig
}
