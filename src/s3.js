const {
  S3Client,
  GetObjectCommand,
  ListObjectsCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3')
const { Upload } = require('@aws-sdk/lib-storage')

const logger = require('./logger').getLogger()

const client = new S3Client()

const APP_BUCKET = process.env.APP_BUCKET_NAME

module.exports.upload = async (path, file, { bucket, contentType, credentials } = {}) => {
  bucket ||= APP_BUCKET
  let key = path
  try {
    const url = new URL(path)
    if (url.protocol === 's3:') {
      bucket = url.host
      key = url.pathname.replace(/^\//, '')
    }
  } catch (err) { /* Type error: not a url. Assume it's a path */ }
  const params = {
    Bucket: bucket,
    Key: key,
    Body: file
  }
  if (contentType) params.ContentType = contentType
  const s3client = credentials ? new S3Client({ credentials }) : client
  logger.verbose(`s3: upload s3://${bucket}/${key}`, params)

  const task = new Upload({ client: s3client, params })
  await task.done()
}

module.exports.download = async (path, { bucket } = {}) => {
  bucket ||= APP_BUCKET
  logger.verbose(`s3: download s3://${bucket}/${path}`)
  const res = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: path
  }))
  return await res.Body.transformToWebStream()
}

module.exports.delete = async (path, { bucket } = {}) => {
  bucket ||= APP_BUCKET
  logger.verbose(`s3: rm s3://${bucket}/${path}`)
  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: path
  }))
}

module.exports.deleteRecursive = async (path, { bucket } = {}) => {
  bucket ||= APP_BUCKET
  let Marker
  while (true) {
    logger.verbose(`s3: ls s3://${bucket}/${path}`)
    const { Contents, IsTruncated } = await client.send(new ListObjectsCommand({
      Bucket: bucket,
      Prefix: path,
      Marker
    }))

    if (!Contents) return // empty directory

    const keys = Contents.map((c) => c.Key)
    Marker = keys[keys.length - 1]
    logger.verbose(`s3: rm s3://${bucket}/${path}`, keys)
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((key) => ({ Key: key })) }
    }))

    if (!IsTruncated) return
  }
}
