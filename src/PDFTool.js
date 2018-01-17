import parseArgs from 'minimist'
import { fullVersion } from './version'
import util from 'util'
import path from 'path'
import process from 'process'
import temp from 'temp'
import autoBind from 'auto-bind2'

export class PDFTool {
  constructor(log) {
    autoBind(this)
    this.log = log
  }

  async run(argv) {
    const options = {
      boolean: [ 'help', 'version' ],
    }

    this.args = parseArgs(argv, options)

    if (this.args._.length < 1) {
      this.log.error(`Please specify a command or 'help'`)
      return -1
    }

    const command = this.args._.shift()

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    if (this.args.help || !command || command === 'help') {
      this.log.info(`
Usage: pdf-o-rama <cmd> [options]

Commands:
help              Shows this help
concat            Concatenate multiple PDFs
fields            Extract the field data from a PDF
strip             Strip an AcroForm from a PDF
watermark         Add a watermark to every page of a PDF
fill              Fill-in fields defined in a JSON5 file with data

Global Options:
  --help          Shows this help.
  --version       Shows the tool version.
`)
      return 0
    }

    switch (command.toLowerCase()) {
      case 'concat':
        return await this.concatPDFs()
      case 'fields':
        return await this.dumpPDFFields()
      case 'strip':
        return await this.stripAcroForm()
      case 'watermark':
        return await this.addWatermark()
      case 'fill':
        return await this.fillPDFFields(project)
      default:
        this.log.error(`Unknown command ${command}.  Use --help to see available commands`)
        return -1
    }

    return 0
  }

  async concatPDFs() {
    const filenames = this.args._

    if (!filenames.length === 0) {
      this.log.error('Must specify at least one PDF file to concatenate')
      return -1
    }

    for (let filename of filenames) {
      if (!fs.existsSync(filename)) {
        this.log.error(`File '${filename}' does not exist`)
        return -1
      }
    }

    const pdfWriter = hummus.createWriter(args['output-file'])

    for (let filename of filenames) {
      pdfWriter.appendPDFPagesFromPDF(filename)
    }

    pdfWriter.end()
  }

  async dumpPDFFields() {
    const filename = this.args._[0]

    if (!filename) {
      this.log.error('Must specify a PDF from which to extract information')
      return -1
    }

    if (!await fs.exists(filename)) {
      this.log.error(`File '${filename}' does not exist`)
      return -1
    }

    const pdfReader = hummus.createReader(filename)
    const formReader = new PDFFormReader()
    let formFields = null

    try {
      formFields = formReader.readFormFields(pdfReader)
    } catch (e) {
      this.log.error(e.message)
      return -1
    }

    const formName = path.basename(filename, '.pdf')

    if (this.invalidChars.test(formName)) {
      this.log.error(`File name ${filename} must only contain charecters '${this.validChars}'`)
      return -1
    }

    const writeable = process.stdout

    fields.forEach(field => {
      writeable.write(JSON5.stringify(field, undefined, '  '))
    })

    return 0
  }

  fillPDFFields() {
    const pdfFilename = this.args._[0]
    const json5Filename = this.args._[1]
    const filledPDFFilename = this.args._[2]

    if (!pdfFilename || !json5Filename) {
      this.log.error('Must specify an input PDF file, a data file and an output PDF file')
      return -1
    }

    let data = null

    try {
      data = JSON5.parse(fs.readFileSync(json5Filename, { encoding: 'utf8' }))
    } catch (e) {
      this.log.error(`Unable to read data file '${json5Filename}'. ${e.message}`)
      return -1
    }

    let pdfWriter = hummus.createWriterToModify(pdfFilename, {
      modifiedFilePath: filledPDFFilename
    })

    try {
      new PDFFormWriter().fillForm(pdfWriter, data)
    } catch (e) {
      this.log.error(`Unable to write filled PDF file. ${e.message}`)
      console.log(e)
      return -1
    }

    pdfWriter.end()
  }
}
