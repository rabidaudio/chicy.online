/* eslint-disable no-unused-expressions */
const { expect } = require('chai')

const { runTests } = require('./utils')

const { createPathRewriter } = require('../src/config')

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

runTests(testRewriter)
