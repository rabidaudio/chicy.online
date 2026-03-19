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
    if (path.length > 0 && !path.match(/^\//)) {
      path = "/" + path
    }
    return path
  }
}

async function handler (event) {
  var request = event.request
  var response = event.response
  var host = ""
  if (request.headers && request.headers['host']) {
    host = request.headers['host'].value
  }

  var config = {}
  try {
    config = await kvsHandle.get('config/' + host, { format: 'json' })
  } catch (err) {
    // don't care, use empty config
  }

  if (event.context.eventType === 'viewer-request') {
    var rewrite = createPathRewriter(config)
    // handle re-write rules
    request.uri = rewrite(request.uri)
    return request
  } else if (event.context.eventType === 'viewer-response') {
    // handle custom headers
    var entries = Object.entries(config.headers || {})
    for (var i = 0; i < entries.length; i++) {
      var key = entries[i][0]
      var value = entries[i][1]
      response.headers[key.toLowerCase()] = { value: value }
    }

    return response
  }
}

if (!CLOUDFORMATION) {
  module.exports = { createPathRewriter, handler, kvsHandle }
}
