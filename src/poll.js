const moment = require('moment')

class TimeoutError extends Error {}

module.exports.TimeoutError = TimeoutError

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A helper method for polling
module.exports.until = (checkFn) => ({
  poll: async ({ interval, timeout } = {}, loopFn) => {
    interval ||= 5000
    timeout ||= Infinity
    if (moment.isDuration(interval)) interval = interval.asMilliseconds()
    if (moment.isDuration(timeout)) timeout = timeout.asMilliseconds()
    const start = new Date().getTime()
    while (true) {
      const res = await loopFn()
      if (await checkFn(res)) {
        return res
      }
      await delay(interval)
      const now = new Date().getTime()
      if ((now - start) > timeout) {
        throw new TimeoutError(`Failed to settle after ${(now - start) / 1000} seconds`)
      }
    }
  }
})
