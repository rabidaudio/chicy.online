const { execSync } = require('node:child_process')

const db = require('../src/db')
const Sites = require('../src/sites')

const up = async () => {
  for await (const site of db.scan('sites')) {
    if (!site.currentDeploymentId) continue

    const { siteId } = site
    console.log(`Migrating ${siteId}`)
    const deployment = await db.get('deployments', { siteId, deploymentId: site.currentDeploymentId })

    await Sites.trackPromotionComplete(site, deployment) // update parameter

    const cmd = `aws s3 rm --recursive --exclude "${site.currentDeploymentId}/*" s3://${process.env.APP_BUCKET_NAME}/sites/${siteId}/content/`
    console.log(cmd)
    execSync(cmd, { stdio: 'inherit' })
  }
}

const down = async () => {
  throw new Error('TODO: down migration unimplemented')
}

module.exports = { up, down }
