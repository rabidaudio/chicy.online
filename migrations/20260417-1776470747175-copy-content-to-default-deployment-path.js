const { execSync } = require('node:child_process')

const db = require('../src/db')

const defaultDeploymentPath = 'none'

// TODO: global lock against any new deployments, sites, etc while migrations are running

const up = async () => {
  for await (const site of db.scan('sites')) {
    if (!site.currentDeploymentId) continue

    const { siteId } = site
    console.log(`Migrating ${siteId}`)
    let cmd = `aws s3 cp --recursive s3://${process.env.APP_BUCKET_NAME}/sites/${siteId}/content/ s3://${process.env.APP_BUCKET_NAME}/sites/${siteId}/content/${defaultDeploymentPath}/`
    console.log(cmd)
    execSync(cmd, { stdio: 'inherit' })

    cmd = `aws s3 cp --recursive s3://${process.env.APP_BUCKET_NAME}/sites/${siteId}/content/${defaultDeploymentPath}/ s3://${process.env.APP_BUCKET_NAME}/sites/${siteId}/content/${site.currentDeploymentId}/`
    console.log(cmd)
    execSync(cmd, { stdio: 'inherit' })
  }
}

const down = async () => {
  // nothing to do
}

module.exports = { up, down }
