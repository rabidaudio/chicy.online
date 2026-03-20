const path = require('node:path')

const xdg = require('xdg-portable/cjs')
const { JSONFilePreset } = require('lowdb/node')

let _db

const { APP_NAME } = require('./utils')

module.exports.getDb = async () => {
  if (_db) return _db

  const configDir = path.join(xdg.configDirs()[0], APP_NAME)
  _db = await JSONFilePreset(configDir, {})
  return _db
}
