// NOTE: this is a CloudFront function, which is a greatly restricted execution
// environment. See
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html

var kvsHandle
if (CLOUDFORMATION) {
  var cf = require('cloudfront')
  kvsHandle = cf.kvs()
} else {
  // mock implementation used for tests
  var kv = {}
  kvsHandle = {
    get: function (key, opts) {
      return kv[key]
    },
    set: function (key, value) {
      kv[key] = value
    },
    clear: function() {
      kv = {}
    }
  }
}

function createPathRewriter (config) {
  var matchers = Object.entries(config.rewriteRules || {}).map(function (entry) {
    return [new RegExp(entry[0]), entry[1]]
  })

  return function (path) {
    for (var i = 0; i < matchers.length; i++) {
      var matcher = matchers[i][0]
      var replacement = matchers[i][1]
      var matches = path.match(matcher)
      if (!matches) continue
      path = replacement
      for (var j = 0; j < matches.length; j++) {
        path = path.replaceAll('${' + j.toString() + '}', matches[j])
      }
    }
    return path
  }
}

function createErrorMatcher (config) {
  var matchers = []
  var entries = Object.entries(config.errorPages || {})
  for (var i = 0; i < entries.length; i++) {
    var key = entries[i][0]
    var value = entries[i][1]
    if (key.match(/^[0-9]+$/)) {
      var s = parseInt(key, 10)
      matchers.push({ start: s, end: s, errorPage: value })
    } else if (key.match(/^[0-9]+-[0-9]+$/)) {
      var bounds = key.split('-', 2).map(function (k) { return parseInt(k, 10) })
      matchers.push({ start: bounds[0], end: bounds[1], errorPage: value })
    }
  }

  return function (code) {
    for (var i = 0; i < matchers.length; i++) {
      var matcher = matchers[i]
      if (code >= matcher.start && code <= matcher.end) {
        return matcher.errorPage
      }
    }
    return null
  }
}

async function handler (event) {
  var distributionId = event.context.distributionId
  var request = event.request
  var response = event.response
  var config = {}
  try {
    config = await kvsHandle.get('config/' + distributionId, { format: 'json' })
  } catch (err) {
    // don't care, use empty config
  }
  console.log(`config ${distributionId} ${JSON.stringify(config)}`)

  if (event.context.eventType === 'viewer-request') {
    var rewrite = createPathRewriter(config)
    // handle re-write rules
    request.uri = rewrite(request.uri)
    return request
  } else if (event.context.eventType === 'viewer-response') {
    // handle error pages
    var accept = (request.headers.accept && request.headers.accept.value) || ''
    if (request.method === 'GET' && response.statusCode >= 400 && accept.match(/text\/html/)) {
      var findErrorPage = createErrorMatcher(config)
      var errorPage = findErrorPage(response.statusCode)
      console.log(`errorPage ${response.statusCode} ${errorPage}`)
      if (errorPage) {
        response.statusCode = 302
        response.statusDescription = 'Found'
        response.headers.location = { value: errorPage }
      }
    }

    // handle custom headers
    var entries = Object.entries(config.headers || {})
    for (var i = 0; i < entries.length; i++) {
      var key = entries[i][0]
      var value = entries[i][1]
      response.headers[key.toLowerCase()] = { value }
    }

    return response
  }
}

if (!CLOUDFORMATION) {
  module.exports = { createPathRewriter, createErrorMatcher, handler, kvsHandle }
}
