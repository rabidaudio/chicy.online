module.exports.until = (checkFn, { interval } = {}) => {
  interval ||= 5000
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  return {
    poll: async (loopFn) => {
      while (true) {
        const res = await loopFn()
        if (await checkFn(res)) {
          return res
        }
        await delay(interval)
      }
    }
  }
}
