/* eslint-disable no-unused-expressions */
const { expect } = require('chai')

const { runTests } = require('./utils')

const {
  createPathRewriter, createErrorMatcher,
  kvsHandle, handler
} = require('../dist/edge_handler.testable')

function testRewriter () {
  const rewrite = createPathRewriter({
    /* eslint-disable no-template-curly-in-string */
    rewriteRules: {
      '^(.*)$': '/root${1}',
      '^(.*)/$': '${1}/index.html',
      '^(.*)/([^.]+)$': '${1}/${2}/index.html'
    }
  })

  expect(rewrite('')).to.equal('/root/index.html')
  expect(rewrite('/')).to.equal('/root/index.html')
  expect(rewrite('/foo')).to.equal('/root/foo/index.html')
  expect(rewrite('/foo/bar/baz')).to.equal('/root/foo/bar/baz/index.html')
  expect(rewrite('/page.html')).to.equal('/root/page.html')
  expect(rewrite('/a/page.html')).to.equal('/root/a/page.html')
  expect(rewrite('/images/peach.jpg')).to.equal('/root/images/peach.jpg')
}

function testErrorMatcher () {
  const errorPage = createErrorMatcher({
    errorPages: {
      404: '/errors/404.html',
      '500-599': '/errors/500.html'
    }
  })
  expect(errorPage(200)).to.equal(null)
  expect(errorPage(400)).to.equal(null)
  expect(errorPage(404)).to.equal('/errors/404.html')
  expect(errorPage(405)).to.equal(null)
  expect(errorPage(500)).to.equal('/errors/500.html')
  expect(errorPage(555)).to.equal('/errors/500.html')
  expect(errorPage(599)).to.equal('/errors/500.html')
  expect(errorPage(600)).to.equal(null)
}

async function testHandler () {
  kvsHandle.set('config/dh_1234567', {
    rewriteRules: {
      '^(.*)$': '/root${1}',
      '^(.*)/$': '${1}/index.html',
      '^(.*)/([^.]+)$': '${1}/${2}/index.html'
    },
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
      distributionId: 'dh_1234567',
      eventType: 'viewer-request'
    },
    request: {
      method: 'GET',
      uri: '/foo/bar/baz',
      headers: {}
    },
    response: {}
  })
  expect(request.uri).to.equal('/root/foo/bar/baz/index.html')

  request = await handler({
    context: {
      distributionId: 'dh_1234567',
      eventType: 'viewer-request'
    },
    request: {
      method: 'GET',
      uri: '/images/fruit.jpg',
      headers: {}
    },
    response: {}
  })
  expect(request.uri).to.equal('/root/images/fruit.jpg')

  let response = await handler({
    context: {
      distributionId: 'dh_1234567',
      eventType: 'viewer-response'
    },
    request: {
      method: 'GET',
      uri: '/images/fruit.jpg',
      headers: {}
    },
    response: {
      statusCode: 200,
      statusDescription: 'OK',
      headers: {}
    }
  })

  expect(response.statusCode).to.equal(200)
  expect(response.headers['access-control-allow-origin'].value).to.equal('*')

  response = await handler({
    context: {
      distributionId: 'dh_1234567',
      eventType: 'viewer-response'
    },
    request: {
      method: 'GET',
      uri: '/not_found.png',
      headers: {
        Accept: 'image/png'
      }
    },
    response: {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: {}
    }
  })
  expect(response.statusCode).to.equal(404)

  response = await handler({
    context: {
      distributionId: 'dh_1234567',
      eventType: 'viewer-response'
    },
    request: {
      method: 'GET',
      uri: '/old_page.html',
      headers: {
        accept: { value: 'text/html' }
      }
    },
    response: {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: {}
    }
  })
  expect(response.statusCode).to.equal(302)
  expect(response.statusDescription).to.equal('Found')
  expect(response.headers.location.value).to.equal('/errors/404.html')
}

runTests(testRewriter, testErrorMatcher, testHandler)
