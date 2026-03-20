const moment = require('moment')

class TimeoutError extends Error {}

module.exports.TimeoutError = TimeoutError

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A helper method for polling
module.exports.until = (checkFn) => ({
  poll: async (...args) => {
    // { interval, timeout } = {}, loopFn
    let loopFn, opts
    if (args.length === 1) {
      loopFn = args[0]
      opts = {}
    } else {
      opts = args[0]
      loopFn = args[1]
    }
    opts.interval ||= 5000
    opts.timeout ||= Infinity
    if (moment.isDuration(opts.interval)) opts.interval = opts.interval.asMilliseconds()
    if (moment.isDuration(opts.timeout)) opts.timeout = opts.timeout.asMilliseconds()
    const start = new Date().getTime()
    while (true) {
      const res = await loopFn()
      if (await checkFn(res)) {
        return res
      }
      await delay(opts.interval)
      const now = new Date().getTime()
      if ((now - start) > opts.timeout) {
        throw new TimeoutError(`Failed to settle after ${(now - start) / 1000} seconds`)
      }
    }
  }
})
