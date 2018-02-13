import parseArgs from 'minimist'
import { fullVersion } from './version'
import path from 'path'
import fs from 'fs'
import process from 'process'
import temp from 'temp'
import autoBind from 'auto-bind2'
import hummus from 'hummus'
import util from 'util'
import JSON5 from 'json5'

fs.readFileAsync = util.promisify(fs.readFile)

function toText(item) {
  if(item.getType() === hummus.ePDFObjectLiteralString) {
    return item.toPDFLiteralString().toText()
  }
  else if(item.getType() === hummus.ePDFObjectHexString) {
    return item.toPDFHexString().toText()
  } else {
    return item.value
  }
}

export class PDFTool {
  constructor(toolName, log) {
    autoBind(this)
    this.toolName = toolName
    this.log = log
  }

  async run(argv) {
    const options = {
      string: ['output-file', 'watermark-file', 'data-file', 'font-file' ],
      boolean: [ 'help', 'version' ],
      alias: {
        'o': 'output-file',
        'w': 'watermark-file',
        'd': 'data-file',
        'f': 'font-file'
      }
    }

    this.args = parseArgs(argv, options)

    let command = 'help'

    if (this.args._.length > 0) {
      command = this.args._[0].toLowerCase()
      this.args._.shift()
    }

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    switch (command) {
      case 'concat':
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} concat <pdf1> <pdf2> [<pdf3> ...] [options]

Options:
  --output-file, -o  Output PDF file

Notes:
  File will be concatenated in the order in which they are given.
`)
          return 0
        }
        return await this.concatPDFs()
      case 'fields':
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} fields <pdf>

Options:
  --output-file, -o  Output JSON file

Notes:
Outputs a JSON file containing information for all the AcroForm fields in the document
`)
          return 0
        }
        return await this.dumpAcroFormFields()
      case 'strip':
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} strip <pdf> [options]

Options:
  --output-file, -o  Output file

Notes:
Strips any AcroForm from the document and compresses the resulting document.
`)
          return 0
        }
        return await this.stripAcroFormAndAnnotations()
      case 'watermark':
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} watermark <pdf> [options]

Options:
  --watermark-file , -w   Watermarked PDF document
  --output-file, -o       Output file

Notes:
Adds a watermark imahe underneath the existing content of each page of the given PDF.
`)
          return 0
        }
        return await this.addWatermark()
      case 'fill':
      if (this.args.help) {
        this.log.info(`
Usage: ${this.toolName} watermark <pdf> [options]

Options:
--watermark , -w   Watermark PDF document
--output-file, -o  Output file
--data-file, -d    JSON/JSON5 data file
--font-file, -f    Font file name to use for text fields

Notes:
Inserts 'form' data into the pages of the PDF.
`)
          return 0
        }
        return await this.fillPDFFields()
      case 'help':
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Commands:
help              Shows this help
concat            Concatenate two or more PDFs
fields            Extract the field data from a PDF
strip             Strip an AcroForm from a PDF
watermark         Add a watermark to every page of a PDF
fill              Fill-in fields defined in a JSON5 file with data

Global Options:
  --help          Shows this help.
  --version       Shows the tool version.
`)
        return 0
      default:
        this.log.error(`Unknown command ${command}.  Use --help to see available commands`)
        return -1
    }

    return 0
  }

  async concatPDFs() {
    const fileNames = this.args._

    if (fileNames.length < 2) {
      this.log.error('Must specify at least two PDF files to concatenate')
      return -1
    }

    for (let fileName of fileNames) {
      if (!fs.existsSync(fileName)) {
        this.log.error(`File '${fileName}' does not exist`)
        return -1
      }
    }

    const outputFile = this.args['output-file']

    if (!outputFile) {
      this.log.error('No output file specified')
      return -1
    }

    const pdfWriter = hummus.createWriter(outputFile)

    for (let fileName of fileNames) {
      pdfWriter.appendPDFPagesFromPDF(fileName)
    }

    pdfWriter.end()
  }

  async dumpAcroFormFields() {
    const fileName = this.args._[0]

    if (!fileName) {
      this.log.error('Must specify a PDF from which to extract information')
      return -1
    }

    if (!fs.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`)
      return -1
    }

    const outputFileName = this.args['output-file']

    if (!outputFileName) {
      this.log.error(`No output file specified`)
      return -1
    }

    this.pdfReader = hummus.createReader(fileName)

    const catalogDict = this.pdfReader
      .queryDictionaryObject(this.pdfReader.getTrailer(), 'Root').toPDFDictionary()

    if (!catalogDict.exists('AcroForm')) {
      this.log.error('PDF does not have an AcroForm')
      return -1
    }

    this.acroformDict = this.pdfReader
      .queryDictionaryObject(catalogDict, 'AcroForm').toPDFDictionary()

    let fieldsArray = this.acroformDict.exists('Fields') ?
      this.pdfReader.queryDictionaryObject(this.acroformDict, 'Fields').toPDFArray() :
      null

    // Page map is used to get page number from page object ID
    const numPages = this.pdfReader.getPagesCount()

    this.pageMap = {}
    for (let i = 0; i < numPages; i++) {
      this.pageMap[this.pdfReader.getPageObjectID(i)] = i
    }

    const writeable = fs.createWriteStream(outputFileName)

    if (fieldsArray) {
      const fields = this.parseFieldsArray(fieldsArray, {}, '')
      writeable.write(JSON.stringify({ fields }, undefined, '  '))
    }

    writeable.end()
    return 0
  }

  startModifiedDictionaryExcluding(originalDict, excludedKeys) {
    let originalDictJS = originalDict.toJSObject()
    let newDict = this.objectsContext.startDictionary()

    Object.getOwnPropertyNames(originalDictJS).forEach((element) => {
      if (!excludedKeys.includes(element)) {
        newDict.writeKey(element)
        this.copyingContext.copyDirectObjectAsIs(originalDictJS[element])
      }
    })

    return newDict
  }

  async stripAcroFormAndAnnotations() {
    // TODO: A better way to do this would be to just copy all the pages one-by-one to the new file. See addWatermark()

    const fileName = this.args._[0]

    if (!fileName) {
      this.log.error('Must specify a PDF from which to remove the AcroForm')
      return -1
    }

    if (!fs.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`)
      return -1
    }

    const outputFileName = this.args['output-file']

    if (!outputFileName) {
      this.log.error(`No output file specified`)
      return -1
    }

    this.pdfWriter = hummus.createWriterToModify(fileName, { modifiedFilePath: outputFileName })
    this.pdfReader = this.pdfWriter.getModifiedFileParser()

    const catalogDict = this.pdfReader.queryDictionaryObject(this.pdfReader.getTrailer(), 'Root').toPDFDictionary()

    if (catalogDict.exists('AcroForm')) {
      // Do some setup
      const catalogObjectID = this.pdfReader.getTrailer().queryObject('Root').toPDFIndirectObjectReference().getObjectID()

      this.copyingContext = this.pdfWriter.createPDFCopyingContextForModifiedFile()
      this.objectsContext = this.pdfWriter.getObjectsContext()

      // Write a new Root object without the AcroForm field
      this.objectsContext.startModifiedIndirectObject(catalogObjectID);
      let modifiedDict = this.startModifiedDictionaryExcluding(catalogDict, ['AcroForm'])

      this.objectsContext
        .endDictionary(modifiedDict) // The new catalog dictionary
        .endIndirectObject() // The new indirect object for the catalog ID

      // Delete the root AcroForm object
      // TODO: Recursively delete all children of the root form
      const acroFormEntry = catalogDict.queryObject('AcroForm')

      if (acroFormEntry.getType() === hummus.ePDFObjectIndirectObjectReference) {
        const acroformObjectID = acroFormEntry.toPDFIndirectObjectReference().getObjectID()

        this.objectsContext.deleteObject(acroformObjectID)
      }

      // Remove all page annotations
      const numPages = this.pdfReader.getPagesCount()

      for (let i = 0; i < numPages; i++) {
        const pageID = this.pdfReader.getPageObjectID(i)
        const pageDict = this.pdfReader.parsePageDictionary(i)

        this.objectsContext.startModifiedIndirectObject(pageID)
        let modifiedPageDict = this.startModifiedDictionaryExcluding(pageDict, ['Annots'])
        this.objectsContext
          .endDictionary(modifiedPageDict)
          .endIndirectObject()
        }

        // TODO: Recursively delete all annotation objects
    }

    this.pdfWriter.end()
    return 0
  }

  async fillPDFFields() {
    const fileName = this.args._[0]

    if (!fileName) {
      this.log.error('Must specify an input PDF file')
      return -1
    }

    if (!fs.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`)
      return -1
    }

    const outputFileName = this.args['output-file']

    if (!outputFileName) {
      this.log.error('No output file specified')
      return -1
    }

    const jsonFileName = this.args['data-file']

    if (!jsonFileName) {
      this.log.error('Must specify a data file')
      return -1
    }

    if (!fs.existsSync(jsonFileName)) {
      this.log.error(`File '${jsonFileName}' does not exist`)
      return -1
    }

    const fontFileName = this.args['font-file']

    let data = null

    try {
      data = await JSON5.parse(await fs.readFileAsync(jsonFileName, { encoding: 'utf8' }))
    } catch (e) {
      this.log.error(`Unable to read data file '${jsonFileName}'. ${e.message}`)
      return -1
    }

    this.pdfWriter = hummus.createWriterToModify(fileName, { modifiedFilePath: outputFileName })
    this.pdfReader = this.pdfWriter.getModifiedFileParser()

    let font = null

    if (fontFileName) {
      font = this.pdfWriter.getFontForFile(fontFileName)
    }

    const catalogDict = this.pdfReader
      .queryDictionaryObject(this.pdfReader.getTrailer(), 'Root').toPDFDictionary()

    if (catalogDict.exists('AcroForm')) {
      this.log.warning('PDF still has an AcroForm')
    }

    const numPages = this.pdfReader.getPagesCount()

    for (let i = 0; i < numPages; i++) {
      const page = this.pdfReader.parsePage(i)
      const pageModifier = new hummus.PDFPageModifier(this.pdfWriter, 0)
      const pageContext = pageModifier.startContext().getContext()
      const fields = data.fields.filter(f => (f.page === i))

      for (let field of fields) {
        switch (field.type) {
          case 'highlight':
            pageContext
              .q()
              .rg(1, 1, 0.6)
              .re(
                field.rect[0], field.rect[1],
                field.rect[2] - field.rect[0],
                field.rect[3] - field.rect[1])
              .f()
              .Q()
            break
          case 'plaintext':
            if (!font) {
              this.log.error('Font file must be specified for plaintext fields')
              return -1
            }
            const rise = (field.rect[3] - field.rect[1]) / 4.0
            pageContext
              .q()
              .BT()
              .g(0)
              .Tm(1, 0, 0, 1, field.rect[0], field.rect[1] + rise)
              .Tf(font, 14)
              .Tj(field.value)
              .ET()
              .Q()
            break
          case 'qrcode':
            break
          case 'checkbox':
            const x = field.rect[0]
            const y = field.rect[1]
            const w = field.rect[2] - x
            const h = field.rect[3] - y
            pageContext
              .q()
              .G(0)
              .w(2.5)
              .J(2)
              .re(x, y, w, h)
              .S()

            if (field.value) {
              const dx = w / 5.0
              const dy = h / 5.0

              pageContext
                .J(1)
                .m(x + dx, y + dy)
                .l(x + w - dx, y + h - dy)
                .S()
                .m(x + dx, y + h - dy)
                .l(x + w - dy, y + dy)
                .S()
            }

            pageContext.Q()
            break
          case 'signhere':
            break
          default:
            this.log.warning(`Unknown field type ${field.type}`)
            break
        }
      }

      pageModifier.endContext().writePage()
    }

    this.pdfWriter.end()
  }

  async addWatermark() {
    const fileName = this.args._[0]

    if (!fileName) {
      this.log.error('Must specify a PDF from which to remove the AcroForm')
      return -1
    }

    if (!fs.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`)
      return -1
    }

    const watermarkFileName = this.args['watermark-file']

    if (!watermarkFileName) {
      this.log.error('No watermark file specified')
      return -1
    }

    if (!fs.existsSync(watermarkFileName)) {
      this.log.error(`File '${watermarkFileName}' does not exist`)
      return -1
    }

    const outputFileName = this.args['output-file']

    if (!outputFileName) {
      this.log.error('No output file specified')
      return -1
    }

    this.pdfWriter = hummus.createWriter(outputFileName)
    this.pdfReader = hummus.createReader(fileName)
    const copyingContext = this.pdfWriter.createPDFCopyingContext(this.pdfReader)

    // First, read in the watermark PDF and create a
    const watermarkInfo = this.getPDFPageInfo(watermarkFileName, 0)

    const formIDs = this.pdfWriter.createFormXObjectsFromPDF(
      watermarkFileName, hummus.ePDFPageBoxMediaBox)

    // Next, iterate through the pages from the source document
    const numPages = this.pdfReader.getPagesCount()

    for (let i = 0; i < numPages; i++) {
      const page = this.pdfReader.parsePage(i)
      const pageMediaBox = page.getMediaBox()
      const newPage = this.pdfWriter.createPage(...pageMediaBox)

      // Merge the page; this will also remove annotations.
      copyingContext.mergePDFPageToPage(newPage, i)

      const pageContext = this.pdfWriter.startPageContentContext(newPage)

      pageContext
        .q()
        .cm(1, 0, 0, 1, (pageMediaBox[2] - watermarkInfo.mediaBox[2]) / 2, (pageMediaBox[3] - watermarkInfo.mediaBox[3]) / 2)
        .doXObject(newPage.getResourcesDictionary().addFormXObjectMapping(formIDs[0]))
        .Q()

      this.pdfWriter.writePage(newPage)
    }

    this.pdfWriter.end()
    return 0
  }

  getPDFPageInfo(fileName, pageNum) {
    const pdfReader = hummus.createReader(fileName)
    const page = pdfReader.parsePage(pageNum)

    return {
      mediaBox: page.getMediaBox()
    }
  }

  parseKids(fieldDictionary, inheritedProperties, baseFieldName) {
    let localEnv = {}

    if (fieldDictionary.exists('FT')) {
      localEnv['FT'] = fieldDictionary.queryObject('FT').toString()
    }
    if (fieldDictionary.exists('Ff')) {
      localEnv['Ff'] = fieldDictionary.queryObject('Ff').toNumber()
    }
    if (fieldDictionary.exists('DA')) {
      localEnv['DA'] = toText(fieldDictionary.queryObject('DA'))
    }
    if (fieldDictionary.exists('Opt')) {
      localEnv['Opt'] = fieldDictionary.queryObject('Opt').toPDFArray()
    }

    let result = this.parseFieldsArray(
      this.pdfReader.queryDictionaryObject(fieldDictionary, 'Kids').toPDFArray(),
      {...inheritedProperties, ...localEnv},
      baseFieldName)

    return result
  }

  parseOnOffValue(fieldDictionary) {
    if (fieldDictionary.exists('V')) {
      let value = fieldDictionary.queryObject('V').toString()
      if (value === 'Off' || value === '') {
        return false
      } else {
        return true
      }
    }
    else {
      return null
    }
  }

  parseRadioButtonValue(fieldDictionary) {
    if (fieldDictionary.exists('V')) {
      let value = fieldDictionary.queryObject('V').toString()

      if (value === 'Off' || value === '') {
        return null
      } else {
        // using true cause sometimes these are actually checkboxes, and there's no underlying kids
        let result = true
        // for radio button this would be an appearance name of a radio button that's turned on. we wanna look for it
        if (fieldDictionary.exists('Kids')) {
          let  kidsArray = this.pdfReader.queryDictionaryObject(fieldDictionary,'Kids').toPDFArray()

          for (let i=0;i<kidsArray.getLength();++i) {
            let widgetDictionary = this.pdfReader.queryArrayObject(kidsArray,i).toPDFDictionary()
            // use the dictionary Ap/N dictionary for looking up the appearance stream name
            let apDictionary = this.pdfReader.queryDictionaryObject(widgetDictionary,'AP').toPDFDictionary()
            let nAppearances = this.pdfReader.queryDictionaryObject(apDictionary,'N').toPDFDictionary()

            if (nAppearances.exists(value)) {
              // Found!
              result = i; // save the selected index as value
              break
            }
          }
        }

        return result
      }
    } else {
      return null
    }
  }

  parseTextFieldValue(fieldDictionary, fieldName) {
    // grab field value, may be either a text string or a text stream
    if (!fieldDictionary.exists(fieldName)) {
      return null
    }

    let valueField = this.pdfReader.queryDictionaryObject(fieldDictionary,fieldName)

    if (valueField.getType() == hummus.ePDFObjectLiteralString) {
      return toText(valueField)
    } else if (valueField.getType() == hummus.ePDFObjectStream) {
      let bytes = []
      let readStream = pdfReader.startReadingFromStream(valueField.toPDFStream())

      while (readStream.notEnded())
      {
        const readData = readStream.read(1)
        // do something with the data
        bytes.push(readData[0])
      }
      return new PDFTextString(bytes).toString()
    } else {
      return null
    }
  }

  parseChoiceValue(fieldDictionary) {
    if (fieldDictionary.exists('V')) {
      let valueField = this.pdfReader.queryDictionaryObject(fieldDictionary,"V")

      if (valueField.getType() == hummus.ePDFObjectLiteralString ||
        valueField.getType() == hummus.ePDFObjectHexString) {
        // text string. read into value
        return toText(valueField)
      } else if (valueField.getType == hummus.ePDFObjectArray) {
        let arrayOfStrings = valueField.toPDFArray().toJSArray()
        return arrayOfStrings.map(toText)
      } else {
        return undefined
      }
    } else {
      return undefined
    }
  }

  parseFieldsValueData(result, fieldDictionary, flags, inheritedProperties) {
    const localFieldType = fieldDictionary.exists('FT') ? fieldDictionary.queryObject('FT').toString() : undefined
    const fieldType = localFieldType || inheritedProperties['FT']

    if (!fieldType) {
      return null; // k. must be a widget
    }

    switch (fieldType) {
      case 'Btn': {
        if ((flags>>16) & 1) {
          // push button
          result['type'] = 'button'
          // no value
        } else if ((flags>>15) & 1) {
          // radio button
          result['type'] = 'radio'
          result['value'] = this.parseRadioButtonValue(fieldDictionary)
        } else {
          // checkbox
          result['type'] = 'checkbox'
          result['value'] = this.parseOnOffValue(fieldDictionary)
        }
        break
      }
      case 'Tx': {
        // result['isFileSelect'] = !!(flags>>20 & 1)
        if ((flags>>25) & 1) {
          result['type'] = 'richtext'
          // rich text, value in 'RV'
          result['value'] = this.parseTextFieldValue(fieldDictionary,'RV')
          result['plainValue'] = this.parseTextFieldValue(fieldDictionary,'V')
        } else {
          result['type'] = 'plaintext'
          result['value'] = this.parseTextFieldValue(fieldDictionary,'V')
        }

        break
      }
      case 'Ch': {
        result['type'] = 'choice'
        result['value'] = this.parseChoiceValue(fieldDictionary)
        break
      }
      case 'Sig': {
        result['type'] = 'signature'
        break
      }
    }
  }

  parseField(fieldDictionary, inheritedProperties, baseFieldName) {
    let fieldNameT = fieldDictionary.exists('T') ? toText(fieldDictionary.queryObject('T')) : undefined
    let fieldNameTU = fieldDictionary.exists('TU') ? toText(fieldDictionary.queryObject('TU')) : undefined
    let fieldNameTM = fieldDictionary.exists('TM') ? toText(fieldDictionary.queryObject('TM')) : undefined
    let fieldFlags = fieldDictionary.exists('Ff') ? fieldDictionary.queryObject('Ff').toNumber() : undefined
    let fieldRect = fieldDictionary.exists('Rect') ? fieldDictionary.queryObject('Rect').toPDFArray().toJSArray() : undefined
    let fieldP = fieldDictionary.exists('P') ? fieldDictionary.queryObject('P').toPDFIndirectObjectReference().getObjectID() : undefined

    fieldFlags = (fieldFlags === undefined ? inheritedProperties['Ff'] : fieldFlags)
    fieldFlags = fieldFlags || 0

    if (fieldRect) {
      fieldRect = fieldRect.map(r => r.value)
    }

    // Assume that if there's no T and no Kids, this is a widget annotation which is not a field
    if (fieldNameT === undefined &&
      !fieldDictionary.exists('Kids') &&
      fieldDictionary.exists('Subtype') &&
      fieldDictionary.queryObject('Subtype').toString() == 'Widget') {
      return null
    }

    let result = {
      name: fieldNameT,
      fullName: fieldNameT === undefined ? undefined : (baseFieldName + fieldNameT),
      //alternateName: fieldNameTU,
      //mappingName: fieldNameTM,
      //isNoExport: !!((fieldFlags>>2) & 1),
      rect: fieldRect,
      page: this.pageMap[fieldP]
    }

    if (fieldDictionary.exists('Kids')) {
      let kids = this.parseKids(fieldDictionary, inheritedProperties, baseFieldName + fieldNameT + '.')

      if (kids) {
        // that would be a non terminal node, otherwise all kids are annotations an null would be returned
        result['kids'] = kids
      } else {
        // a terminal node, so kids array returned empty
        this.parseFieldsValueData(result, fieldDictionary, fieldFlags, inheritedProperties)
      }
    } else {
      // read fields value data
      this.parseFieldsValueData(result, fieldDictionary, fieldFlags, inheritedProperties)
    }

    return result
  }

  parseFieldsArray(fieldsArray, inheritedProperties, baseFieldName) {
    let result = []

    for (let i=0; i < fieldsArray.getLength(); ++i) {
      let fieldResult = this.parseField(
        this.pdfReader.queryArrayObject(fieldsArray,i).toPDFDictionary(),
        inheritedProperties, baseFieldName)

      if (fieldResult) {
        result.push(fieldResult)
      }
    }

    return result
  }
}
