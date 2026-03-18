const path = require('node:path')

const xdg = require('xdg-portable/cjs')
const { JSONFilePreset } = require('lowdb/node')

let _db

module.exports.getDb = async () => {
  if (_db) return _db

  const configDir = path.join(xdg.configDirs()[0], 'static-chic')
  _db = await JSONFilePreset(configDir, {})
  return _db
}
