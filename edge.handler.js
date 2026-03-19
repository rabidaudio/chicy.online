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

// rewriteRules are an array of objects with
// `match` (string regex to apply the rule) if matching,
// `flags` (string of optional flags to add to the matcher, e.g. "g". Defaults to ""),
// `replace` (string replace with ${1} replacements for capture groups of match),
// and `last` (optional boolean to stop processing after rule is matched, default false).
// This schema is loosely based on Apache's mod_rewrite
function createPathRewriter (config) {
  var matchers = (config.rewriteRules || []).map(function (entry) {
    return {
      match: new RegExp(entry.match, entry.flags || ""),
      replace: entry.replace,
      last: !!entry.last
    }
  })

  return function (path) {
    for (var i = 0; i < matchers.length; i++) {
      var matcher = matchers[i]
      var matches = path.match(matcher.match)
      console.log(`match step ${matcher.match.toString()} -> '${matcher.replace}' last=${matcher.last} path '${path}' matches ${JSON.stringify(matches)}`)
      if (!matches) continue
      path = matcher.replace
      for (var j = 0; j < matches.length; j++) {
        var tag = '${' + j.toString() + '}'
        console.log(`replace ${j}: '${tag}' with '${matches[j]}'`)
        path = path.replaceAll(tag, matches[j])
      }
      if (matcher.last) break
    }
    // uri must start with a "/" if changed
    if (path.length > 0 && !path.match(/^\//)) {
      path = "/" + path
    }
    console.log(`final '${path}'`)
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
