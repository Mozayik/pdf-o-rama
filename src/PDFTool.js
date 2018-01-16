import parseArgs from 'minimist'
import { fullVersion } from './version'
import util from 'util'
import path from 'path'
import process from 'process'
import temp from 'temp'

export class PDFTool {
  constructor(log) {
    this.log = log
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version' ],
    }
    this.args = parseArgs(argv, options)

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    if (this.args.help) {
      this.log.info(`
usage: tool <cmd> [options]

options:
  --help                        Shows this help.
  --version                     Shows the tool version.
`)
      return 0
    }

    return 0
  }
}
