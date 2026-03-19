/* eslint-disable no-unused-expressions */
const { expect } = require('chai')

const { runTests } = require('./utils')

const {
  createPathRewriter, kvsHandle, handler
} = require('../dist/edge_handler.testable')

function testRewriter () {
  const rewrite = createPathRewriter({
    /* eslint-disable no-template-curly-in-string */
    rewriteRules: [
      { match: '^$', replace: '/index.html', last: true },
      { match: '^/(.*)$', replace: '/root/${1}' },
      { match: '^(.*?)/$', replace: '${1}/index.html' },
      { match: '^(.*?)/([^.]+)$', replace: '${1}/${2}/index.html' }
    ]
  })

  expect(rewrite('')).to.equal('/index.html')
  expect(rewrite('/')).to.equal('/root/index.html')
  expect(rewrite('/foo')).to.equal('/root/foo/index.html')
  expect(rewrite('/foo/bar/baz')).to.equal('/root/foo/bar/baz/index.html')
  expect(rewrite('/page.html')).to.equal('/root/page.html')
  expect(rewrite('/a/page.html')).to.equal('/root/a/page.html')
  expect(rewrite('/images/peach.jpg')).to.equal('/root/images/peach.jpg')
}

function testRewriterFallthrough () {
  const rewrite = createPathRewriter({
    /* eslint-disable no-template-curly-in-string */
    rewriteRules: [
      { match: '^/(f.+)/?$', replace: '/foo', last: false },
      { match: '(.*?)o+(.*)', replace: '${1}0${2}', last: true },
      { match: '^/(.+)$', replace: '/${1}/${1}', last: false }
    ]
  })

  expect(rewrite('')).to.equal('')
  expect(rewrite('/')).to.equal('/')
  expect(rewrite('/fab')).to.equal('/f0')
  expect(rewrite('/fab/')).to.equal('/f0')
  expect(rewrite('/bar')).to.equal('/bar/bar')
  expect(rewrite('/booooo')).to.equal('/b0')
}

async function testHandler () {
  kvsHandle.set('config/example.com', {
    rewriteRules: [
      { match: '^/(.*)$', replace: '/root/${1}' },
      { match: '^(.*?)/$', replace: '${1}/index.html' },
      { match: '^(.*?)/([^.]+)$', replace: '${1}/${2}/index.html' }
    ],
    errorPages: {
      404: '/errors/404.html',
      '500-599': '/errors/500.html'
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  })

  let request = await handler({
    context: {
      eventType: 'viewer-request'
    },
    request: {
      method: 'GET',
      uri: '/foo/bar/baz',
      headers: {
        host: { value: 'example.com' }
      }
    },
    response: {}
  })
  expect(request.uri).to.equal('/root/foo/bar/baz/index.html')

  request = await handler({
    context: {
      eventType: 'viewer-request'
    },
    request: {
      method: 'GET',
      uri: '/images/fruit.jpg',
      headers: {
        host: { value: 'example.com' }
      }
    },
    response: {}
  })
  expect(request.uri).to.equal('/root/images/fruit.jpg')

  const response = await handler({
    context: {
      eventType: 'viewer-response'
    },
    request: {
      method: 'GET',
      uri: '/images/fruit.jpg',
      headers: {
        host: { value: 'example.com' }
      }
    },
    response: {
      statusCode: 200,
      statusDescription: 'OK',
      headers: {}
    }
  })

  expect(response.statusCode).to.equal(200)
  expect(response.headers['access-control-allow-origin'].value).to.equal('*')
}

runTests(testRewriter, testRewriterFallthrough, testHandler)
