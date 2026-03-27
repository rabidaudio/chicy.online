const consoleTablePrinter = require('console-table-printer')
const CliTable = require('cli-table3')

const isInteractive = require('is-interactive').default()

const showTable = (data, { full } = {}) => {
  if (full === undefined) full = isInteractive
  if (full) {
    consoleTablePrinter.printTable(data)
  } else {
    const table = new CliTable({
      chars: {
        top: '',
        'top-mid': '',
        'top-left': '',
        'top-right': '',
        bottom: '',
        'bottom-mid': '',
        'bottom-left': '',
        'bottom-right': '',
        left: '',
        'left-mid': '',
        mid: '',
        'mid-mid': '',
        right: '',
        'right-mid': '',
        middle: '  '
      },
      style: { 'padding-left': 0, 'padding-right': 0 }
    })
    if (data[0]) table.push(Object.keys(data[0]).map(k => k.toUpperCase()))
    table.push(...data.map(d => Object.values(d)))
    console.log(table.toString())
  }
}

module.exports = { isInteractive, showTable }
