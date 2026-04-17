const { execSync } = require('node:child_process')
const { createReadStream } = require('node:fs')
const { glob, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { buffer } = require('node:stream/consumers')
const { pipeline } = require('node:stream/promises')

const mime = require('mime-types')
const { simpleGit } = require('simple-git')
const tar = require('tar')

const logger = require('./logger').getLogger()

const s3 = require('./s3')

const APP_BUCKET = process.env.APP_BUCKET_NAME
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET_NAME

// where temporary deployment tarballs are stored in s3
const getTarballKey = (siteId, deploymentId) => `pending_deployments/${siteId}/${deploymentId}.tar.gz`

// where site git repos are stored on S3
const getSiteDeploymentsKey = (siteId) => `deployments/${siteId}`

// where a temporary deployment tarball should be uploaded
const getDeploymentTarballPath = (siteId, deploymentId) => `s3://${UPLOADS_BUCKET}/${getTarballKey(siteId, deploymentId)}`

// if the given path is a valid temporary tarball path on s3, return it's siteId and deploymentId. Otherwise return null
const parseDeploymentTarballPath = (path) => {
  const match = path.match(/^\/?pending_deployments\/([a-z0-9-]+)\/(d_[0-9a-f]+).tar.gz$/)
  if (!match) return null
  return { siteId: match[1], deploymentId: match[2] }
}

// where live site content is stored on S3
const getAllSiteContentKey = (siteId) => `sites/${siteId}/content`
const getSiteContentKey = (siteId, deploymentId) => `${getAllSiteContentKey(siteId)}/${deploymentId}`

const getPromoteKey = (siteId) => `pending_promotions/${siteId}.promote`

const parsePromoteKey = (path) => {
  const match = path.match(/^\/?pending_promotions\/([a-z0-9-]+)\.promote$/)
  if (!match) return null
  return { siteId: match[1] }
}

// the git origin to push/pull to
const getOrigin = (siteId) => `s3://${APP_BUCKET}/${getSiteDeploymentsKey(siteId)}`

const allFilesRelative = async (cwd, opts = {}) => {
  return await Array.fromAsync(async function * () {
    logger.verbose('glob: ["**/*", "**/.*"]', opts)
    for await (const entry of glob(['**/*', '**/.*'], { ...opts, cwd, withFileTypes: true })) {
      if (entry.isFile()) yield path.relative(cwd, path.join(entry.parentPath, entry.name))
    }
  }())
}

module.exports = {
  getSiteDeploymentsKey,
  getAllSiteContentKey,
  getOrigin,
  getTarballKey,
  getDeploymentTarballPath,
  parseDeploymentTarballPath,
  getPromoteKey,
  parsePromoteKey,
  allFilesRelative,

  // create a stream of a .tar.gz of the directory at the provided path.
  // returns a node stream that can be piped to a file or request.
  createTarball: async (directoryPath, { exclude } = {}) => {
    exclude ||= []
    logger.info(`creating tarball of ${directoryPath}`)
    const files = await allFilesRelative(directoryPath, { exclude })
    for (const file of files) {
      logger.verbose(file)
    }
    return ReadableStream.from(tar.create({ cwd: directoryPath, gzip: true }, files))
  },

  deploy: async ({ siteId, deploymentId, tarballPath, isFirst, config }) => {
    const origin = getOrigin(siteId)
    const repo = new Repo({ origin, deploymentId })
    await repo.prepare()
    if (isFirst) {
      logger.info(`initializing repository ${siteId}`)
      await repo.init()
    } else {
      logger.info(`cloning repository ${siteId}`)
      await repo.clone()
      logger.info('deleting existing files')
      await repo.clearWorkingDirectory({ retain: config.retain || [] })
    }

    logger.info('downloading tarball')
    const tarball = await s3.download(tarballPath, { bucket: UPLOADS_BUCKET })
    logger.info('extracting tarball')
    await repo.extractTarball(tarball)
    await repo.touch(deploymentId)
    logger.info('committing')
    const commit = await repo.commitAllFiles({
      message: `deployment:${deploymentId}`,
      tag: deploymentId
    })
    logger.info(`git: sha=${commit}`)
    if (isFirst) {
      logger.info('creating origin')
      await repo.createOrigin()
    }
    logger.info(`pushing to ${origin}`)
    await repo.push()
    logger.info('cleaning up')
    await repo.cleanup()
    await s3.delete(tarballPath, { bucket: UPLOADS_BUCKET })

    return commit
  },

  triggerPromotion: async ({ siteId, deploymentId }) => {
    const key = getPromoteKey(siteId)
    await s3.upload(key, Buffer.from(deploymentId), { bucket: UPLOADS_BUCKET })
  },

  readPromoteRequest: async (promoteKey) => {
    const pathParams = parsePromoteKey(promoteKey)
    if (!pathParams) return null

    const { siteId } = pathParams
    const body = await s3.download(promoteKey, { bucket: UPLOADS_BUCKET })
    const deploymentId = (await buffer(body)).toString('utf8')
    return { siteId, deploymentId }
  },

  promote: async ({ siteId, deploymentId }) => {
    const origin = getOrigin(siteId)
    const repo = new Repo({ origin })
    await repo.prepare()
    logger.info(`cloning repository ${siteId}`)
    await repo.clone()
    logger.info(`checking out deployment ${deploymentId}`)
    await repo.checkout(deploymentId)

    const siteContent = getSiteContentKey(siteId, deploymentId)
    logger.info(`deleting live site ${siteContent}`)
    await s3.deleteRecursive(siteContent)

    logger.info('copying files')
    const files = await allFilesRelative(repo.cwd, { exclude: ['.git/**'] })
    for (const file of files) {
      const key = path.join(siteContent, file)
      // if we don't specify the content type, CF will send it as a binary file
      // and the browser will simply download it
      const contentType = mime.contentType(path.extname(file))
      const absPath = path.join(repo.cwd, file)
      await s3.upload(key, createReadStream(absPath), { contentType })
    }

    logger.info('cleaning up')
    await repo.cleanup()
  }

  // STOPSHIP: remove old deployments
  // removeOldDeployment: ({ siteId, deploymentId })

// TODO: squash deployments - reduce the number/size of old deployments
}

class Repo {
  constructor ({ origin }) {
    this.origin = origin
  }

  async prepare () {
    logger.verbose(`git: mkdir /tmp/${process.env.APP_ID}-xxxxx`)
    this.cwd = await mkdtemp(path.join(tmpdir(), `${process.env.APP_ID}-`))
    // https://github.com/steveukx/git-js/blob/main/docs/PLUGIN-UNSAFE-ACTIONS.md
    this.git = simpleGit({ baseDir: this.cwd, unsafe: { allowUnsafePack: true } })
  }

  checkStorage () {
    logger.verbose(execSync('df -h /tmp'))
  }

  async init () {
    logger.verbose('git: git init')
    await this.git.init()
    logger.verbose('git: git-lfs-s3 install')
    execSync('git-lfs-s3 install', { cwd: this.cwd })
    logger.verbose('git: git checkout -b main')
    await this.git.checkoutLocalBranch('main')
    await this.config()
    this.checkStorage()
  }

  async config () {
    await this.git.addConfig('user.email', `bot@${process.env.SITES_DOMAIN}`)
    await this.git.addConfig('user.name', `bot@${process.env.SITES_DOMAIN}`)
    await this.git.addConfig('lfs.customtransfer.git-lfs-s3.path', 'git-lfs-s3')
    await this.git.addConfig('lfs.standalonetransferagent', 'git-lfs-s3')
    const config = await this.git.listConfig()
    logger.verbose('git config', config)
  }

  async clone () {
    logger.info(`cloning repository ${this.origin}`)
    logger.verbose(`git: git clone ${this.origin}`)
    await this.git.raw('clone', '-c', 'protocol.s3.allow=always', this.origin, this.cwd)
    await this.config()
    this.checkStorage()
  }

  async checkout (tag) {
    logger.verbose(`git: git checkout ${tag}`)
    await this.git.checkout(tag)
  }

  async clearWorkingDirectory ({ retain }) {
    const files = await allFilesRelative(this.cwd, { exclude: ['.git/**', ...retain] })
    logger.verbose('git: git rm -r .')
    await this.git.rm(files)
  }

  async extractTarball (tarball) {
    logger.verbose(`git: tar -xvz ${this.cwd}`)
    const extract = tar.extract({
      cwd: this.cwd,
      strict: true,
      onReadEntry: ({ path }) => logger.verbose(`extract: ${path}`)
    })
    await pipeline(tarball, extract) // wait for extraction to complete
  }

  async touch (content) {
    // ensures commits have something unique TODO: allow-empty instead?
    logger.verbose(`git: echo '${content}' > .chic-version`)
    await writeFile(path.join(this.cwd, '.chic-version'), content)
  }

  async commitAllFiles ({ message, tag }) {
    const files = await allFilesRelative(this.cwd, { exclude: ['.git'] })
    logger.verbose('git: git add -A .')
    await this.git.add(files)
    logger.verbose(`git: git commit -m "${message}"`)
    const { commit } = await this.git.commit(message)
    logger.verbose(`git: git tag ${tag}`)
    await this.git.addTag(tag)
    this.checkStorage()
    return commit
  }

  async createOrigin () {
    // https://github.com/awslabs/git-remote-s3
    logger.verbose(`git: git remote add origin ${this.origin}`)
    await this.git.addRemote('origin', this.origin)
  }

  async push () {
    logger.verbose('git: git push origin main')
    await this.git.push('origin', 'main')
    logger.verbose('git: git push --tags origin')
    await this.git.pushTags('origin')
  }

  async cleanup () {
    logger.verbose(`git: rm -rf ${this.cwd}`)
    await rm(this.cwd, { recursive: true, force: true })
    this.checkStorage()
  }
}
