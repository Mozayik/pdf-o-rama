import parseArgs from "minimist"
import { fullVersion } from "./version"
import fs from "fs-extra"
import tmp from "tmp-promise"
import hummus from "hummus"
import JSON5 from "json5"
import QRCode from "qrcode"
import md5 from "md5"
import autobind from "autobind-decorator"
import assert from "assert"

@autobind
export class PDFTool {
  constructor(toolName, log, container) {
    container = container || {}

    this.toolName = toolName
    this.log = log
    this.hummus = container.hummus || hummus
    this.fs = container.fs || fs
  }

  async concat(options) {
    assert(options.pdfFiles.length !== 0, "Must specify at least one PDF file")
    assert(options.outputFile, "No output file specified")

    if (options.pdfFiles.length >= 2) {
      for (let pdfFile of options.pdfFiles) {
        if (!this.fs.existsSync(pdfFile)) {
          throw new Error(`File '${pdfFile}' does not exist`)
        }
      }

      const pdfWriter = this.hummus.createWriter(options.outputFile)

      for (let pdfFile of options.pdfFiles) {
        pdfWriter.appendPDFPagesFromPDF(pdfFile)
      }

      pdfWriter.end()
    } else {
      this.fs.copyFile(options.pdfFiles[0], options.outputFile)
    }
  }

  parsePageTree(context, dict) {
    const dictType = dict.queryObject("Type").value

    if (dictType === "Pages") {
      // Parse the kids of this tree
      const kids = dict.queryObject("Kids").toJSArray()

      kids.forEach((kid) => {
        this.parsePageTree(
          context,
          this.pdfReader.parseNewObject(kid.getObjectID())
        )
      })
    } else if (dictType === "Page") {
      // Parse any field annotations on the page
      let annots = dict.exists("Annots") ? dict.queryObject("Annots") : null

      if (annots) {
        if (
          annots.getType() === this.hummus.ePDFObjectIndirectObjectReference
        ) {
          annots = this.pdfReader.parseNewObject(annots.getObjectID())
        }

        annots = annots.toJSArray()

        annots.forEach((annot) => {
          let annotDict = null

          if (
            annot.getType() === this.hummus.ePDFObjectIndirectObjectReference
          ) {
            annotDict = this.pdfReader.parseNewObject(annot.getObjectID())
          } else {
            annotDict = annot
          }

          const subType = annotDict.queryObject("Subtype").value
          const hasName = annotDict.exists("T")
          const hasKids = annotDict.exists("Kids")

          if (subType === "Widget" && !hasKids && hasName) {
            context.fields.push({
              name: annotDict.queryObject("T").value,
              page: context.nextPageNum,
              rect: annotDict
                .queryObject("Rect")
                .toJSArray()
                .map((n) => n.value),
            })
          }
        })

        context.nextPageNum += 1
      }
    }
  }

  async fields(options) {
    assert(
      options.pdfFile,
      "Must specify a PDF from which to extract information"
    )
    assert(
      this.fs.existsSync(options.pdfFile),
      `File '${options.pdfFile}' does not exist`
    )
    assert(options.dataFile, `No output data file specified`)

    this.pdfReader = this.hummus.createReader(options.pdfFile)

    const catalogDict = this.pdfReader.queryDictionaryObject(
      this.pdfReader.getTrailer(),
      "Root"
    )
    const pagesDict = this.pdfReader.parseNewObject(
      catalogDict.queryObject("Pages").getObjectID()
    )
    let fieldData = {
      numPages: pagesDict.queryObject("Count").value,
    }

    if (catalogDict.exists("AcroForm")) {
      const context = { nextPageNum: 0, fields: [] }

      this.parsePageTree(context, pagesDict)
      fieldData.fields = context.fields

      if (options.outputFile) {
        await this.stripAcroFormAndAnnotations(
          options.pdfFile,
          options.outputFile
        )
      }
    } else {
      fieldData.fields = []

      if (options.outputFile) {
        await this.fs.copyFile(options.pdfFile, options.outputFile)
      }
    }

    if (options.outputFile) {
      const buf = await this.fs.readFile(options.outputFile)

      fieldData.md5 = md5(buf.buffer)
    }

    await this.fs.writeFile(
      options.dataFile,
      JSON5.stringify(fieldData, undefined, "  ")
    )
  }

  async strip(options) {
    assert(
      options.pdfFile,
      "Must specify a PDF from which to remove the AcroForm"
    )
    assert(
      this.fs.existsSync(options.pdfFile),
      `File '${options.pdfFile}' does not exist`
    )
    assert(options.outputFile, `No output file specified`)

    await this.stripAcroFormAndAnnotations(options.pdfFile, options.outputFile)
  }

  async stripAcroFormAndAnnotations(pdfFile, outputFile) {
    // This strips the AcroForm and page annotations as a side-effect
    // merging them into a new page.
    const pdfWriter = hummus.createWriter(outputFile)
    const pdfReader = hummus.createReader(pdfFile)
    const copyingContext = pdfWriter.createPDFCopyingContext(pdfReader)

    // Next, iterate through the pages from the source document
    const numPages = pdfReader.getPagesCount()

    for (let i = 0; i < numPages; i++) {
      const page = pdfReader.parsePage(i)
      const pageMediaBox = page.getMediaBox()
      const newPage = pdfWriter.createPage(...pageMediaBox)

      // Merge the page; this will also remove annotations.
      copyingContext.mergePDFPageToPage(newPage, i)
      pdfWriter.writePage(newPage)
    }

    pdfWriter.end()
  }

  async fill(options) {
    assert(options.pdfFile, "Must specify an input PDF file")
    assert(
      this.fs.existsSync(options.pdfFile),
      `File '${options.pdfFile}' does not exist`
    )
    assert(options.outputFile, "No output file specified")
    assert(
      (options.dataFile && !options.data) ||
        (!options.dataFile && options.data),
      "Must specify a data file or data"
    )

    let data = options.data

    if (!data) {
      try {
        data = await JSON5.parse(
          await this.fs.readFile(options.dataFile, { encoding: "utf8" })
        )
      } catch (e) {
        throw new Error(
          `Unable to read data file '${options.dataFile}'. ${e.message}`
        )
      }
    }

    if (data.md5) {
      const buf = await this.fs.readFile(options.pdfFile)

      if (md5(buf.buffer) !== data.md5) {
        throw new Error(
          `MD5 for ${options.pdfFile} does not match the one in the data`
        )
      }
    }

    this.pdfWriter = hummus.createWriterToModify(options.pdfFile, {
      modifiedFilePath: options.outputFile,
    })
    this.pdfReader = this.pdfWriter.getModifiedFileParser()

    let font = null
    let fontDims = null

    if (options.fontFile) {
      font = this.pdfWriter.getFontForFile(options.fontFile)
      fontDims = font.calculateTextDimensions("X", 14)
    }

    const catalogDict = this.pdfReader
      .queryDictionaryObject(this.pdfReader.getTrailer(), "Root")
      .toPDFDictionary()

    if (catalogDict.exists("AcroForm")) {
      this.log.warning("PDF still has an AcroForm")
    }

    const numPages = this.pdfReader.getPagesCount()

    for (let i = 0; i < numPages; i++) {
      const pageModifier = new hummus.PDFPageModifier(this.pdfWriter, i)
      let pageContext = pageModifier.startContext().getContext()
      const fields = data.fields.filter((f) => f.page === i)

      for (let field of fields) {
        const x = field.rect[0]
        const y = field.rect[1]
        const w = field.rect[2] - x
        const h = field.rect[3] - y
        const rise = h / 4.0
        const halfH = h / 2

        switch (field.type) {
          case "highlight":
            pageContext
              .q()
              .rg(1, 1, 0.6)
              .re(x, y, w, h)
              .f()
              .Q()
            break
          case "plaintext":
            if (!font) {
              throw new Error(
                "Font file must be specified for plaintext fields"
              )
            }
            pageContext
              .q()
              .BT()
              .g(0)
              .Tm(1, 0, 0, 1, x, y + rise)
              .Tf(font, 14)
              .Tj(field.value || "")
              .ET()
              .Q()
            break
          case "qrcode":
            const pngFileName = await tmp.tmpName({ postfix: ".png" })

            await QRCode.toFile(pngFileName, field.value || "")

            pageModifier.endContext()
            let imageXObject = this.pdfWriter.createFormXObjectFromPNG(
              pngFileName
            )
            pageContext = pageModifier.startContext().getContext()

            pageContext
              .q()
              .cm(1, 0, 0, 1, x, y)
              .doXObject(imageXObject)
              .Q()

            fs.unlinkSync(pngFileName)
            break
          case "checkbox":
            pageContext
              .q()
              .G(0)
              .w(2.5)

            if (options.checkboxBorders) {
              pageContext
                .J(2)
                .re(x, y, w, h)
                .S()
            }

            if (!!field.value) {
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
          case "signhere":
            if (!font) {
              throw new Error("Font file must be specified for signhere fields")
            }

            const q = Math.PI / 4.0

            pageModifier.endContext()

            let gsID = this.createOpacityExtGState(0.5)
            let formXObject = this.pdfWriter.createFormXObject(0, 0, w, h)
            let gsName = formXObject
              .getResourcesDictionary()
              .addExtGStateMapping(gsID)

            formXObject
              .getContentContext()
              .q()
              .gs(gsName)
              .w(1.0)
              .G(0)
              .rg(1, 0.6, 1)
              .m(0, halfH)
              .l(halfH, 0)
              .l(w, 0)
              .l(w, h)
              .l(halfH, h)
              .h()
              .B()
              .BT()
              .g(0)
              .Tm(1, 0, 0, 1, halfH, halfH - fontDims.height / 2.0)
              .Tf(font, 12)
              .Tj(`Sign Here ${field.value || ""}`)
              .ET()
              .Q()
            this.pdfWriter.endFormXObject(formXObject)

            pageContext = pageModifier.startContext().getContext()

            pageContext
              .q()
              .cm(1, 0, 0, 1, x, y + halfH)
              .cm(Math.cos(q), Math.sin(q), -Math.sin(q), Math.cos(q), 0, 0)
              .cm(1, 0, 0, 1, 0, -halfH)
              // NOTE: The coordinate space of the XObjects is the same as the page!
              .doXObject(formXObject)
              .Q()
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

  createOpacityExtGState(opacity) {
    const context = this.pdfWriter.getObjectsContext()
    const id = context.startNewIndirectObject()
    const dict = context.startDictionary()

    dict
      .writeKey("type")
      .writeNameValue("ExtGState")
      .writeKey("ca")
    context.writeNumber(opacity).endLine()
    dict.writeKey("CA")
    context
      .writeNumber(opacity)
      .endLine()
      .endDictionary(dict)

    return id
  }

  async watermark(options) {
    assert(
      options.pdfFile,
      "Must specify a PDF from which to remove the AcroForm"
    )
    assert(
      this.fs.existsSync(options.pdfFile),
      `File '${options.pdfFile}' does not exist`
    )
    assert(options.watermarkFile, "No watermark file specified")
    assert(
      this.fs.existsSync(options.watermarkFile),
      `File '${options.watermarkFile}' does not exist`
    )
    assert(options.outputFile, "No output file specified")

    this.pdfWriter = hummus.createWriter(options.outputFile)
    this.pdfReader = hummus.createReader(options.pdfFile)
    const copyingContext = this.pdfWriter.createPDFCopyingContext(
      this.pdfReader
    )

    const getPDFPageInfo = (pdfFile, pageNum) => {
      const pdfReader = this.hummus.createReader(pdfFile)
      const page = pdfReader.parsePage(pageNum)

      return {
        mediaBox: page.getMediaBox(),
      }
    }

    // First, read in the watermark PDF and create a
    const watermarkInfo = getPDFPageInfo(options.watermarkFile, 0)

    const formIDs = this.pdfWriter.createFormXObjectsFromPDF(
      options.watermarkFile,
      hummus.ePDFPageBoxMediaBox
    )

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
        .cm(
          1,
          0,
          0,
          1,
          (pageMediaBox[2] - watermarkInfo.mediaBox[2]) / 2,
          (pageMediaBox[3] - watermarkInfo.mediaBox[3]) / 2
        )
        .doXObject(
          newPage.getResourcesDictionary().addFormXObjectMapping(formIDs[0])
        )
        .Q()

      this.pdfWriter.writePage(newPage)
    }

    this.pdfWriter.end()
  }

  async run(argv) {
    const options = {
      string: ["output-file", "watermark-file", "data-file", "font-file"],
      boolean: ["help", "version", "checkbox-borders", "debug"],
      alias: {
        o: "output-file",
        w: "watermark-file",
        d: "data-file",
        f: "font-file",
        c: "checkbox-borders",
      },
    }

    const args = parseArgs(argv, options)

    this.debug = args.debug

    let command = "help"

    if (args._.length > 0) {
      command = args._[0].toLowerCase()
      args._.shift()
    }

    if (args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    switch (command) {
      case "concat":
        if (args.help) {
          this.log.info(`
Usage: ${this.toolName} concat <pdf1> <pdf2> [<pdf3> ...] [options]

Options:
  --output-file, -o  Output PDF file

Notes:
  File will be concatenated in the order in which they are given.
`)
          return 0
        }
        return await this.concat({
          pdfFiles: args._,
          outputFile: args["output-file"],
        })
      case "fields":
        if (args.help) {
          this.log.info(`
Usage: ${this.toolName} fields <pdf>

Options:
--data-file, -d         Output JSON5 file
--output-file, -o       Optional output PDF stripped of AcroForm and annotations.
                        Adds 'md5' field to the output JSON5.

Notes:
Outputs a JSON5 file containing information for all the AcroForm fields in the document.
If an output file is specified a stripped PDF will be generated (see 'strip' command)
and an MD5 hash for the file will be included in the data file.
`)
          return 0
        }
        return await this.fields({
          pdfFile: args._[0],
          dataFile: args["data-file"],
          outputFile: args["output-file"],
        })
      case "strip":
        if (args.help) {
          this.log.info(`
Usage: ${this.toolName} strip <pdf> [options]

Options:
  --output-file, -o    Output PDF file

Notes:
Strips any AcroForm and page annotations from the document.
`)
          return 0
        }
        return await this.strip({
          pdfFile: args._[0],
          outputFile: args["output-file"],
        })
      case "watermark":
        if (args.help) {
          this.log.info(`
Usage: ${this.toolName} watermark <pdf> [options]

Options:
  --watermark-file , -w   Watermarked PDF document
  --output-file, -o       Output PDF file

Notes:
Adds a watermark images to the existing content of each page of the given PDF.
`)
          return 0
        }
        return await this.watermark({
          pdfFile: args._[0],
          watermarkFile: args["watermark-file"],
          outputFile: args["output-file"],
        })
      case "fill":
        if (args.help) {
          this.log.info(`
Usage: ${this.toolName} fill <pdf> [options]

Options:
--output-file, -o       Output PDF file
--data-file, -d         Input JSON5 data file
--font-file, -f         Input font file name to use for text fields
--checkbox-borders, -c  Put borders around checkboxes

Notes:
Inserts 'form' data into the pages of the PDF.
`)
          return 0
        }
        return await this.fill({
          pdfFile: args._[0],
          outputFile: args["output-file"],
          dataFile: args["data-file"],
          fontFile: args["font-file"],
          checkboxBorders: !!args["checkbox-borders"],
        })
      case "help":
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Commands:
help              Shows this help
concat            Concatenate two or more PDFs
fields            Extract the field data from a PDF and optionally
                  create a PDF stripped of its AcroForm and annotations.
                  Generates an MD5 hash for the stripped PDF.
strip             Strip an AcroForm from a PDF
watermark         Add a watermark to every page of a PDF. Strips
                  AcroForms and annotations in the resulting file.
fill              Fill-in "fields" defined in a JSON5 file with data,
                  checking against existing MD5 has for changes.

Global Options:
  --help          Shows this help.
  --version       Shows the tool version.
`)
        return 0
      default:
        this.log.error(
          `Unknown command ${command}.  Use --help to see available commands`
        )
        return -1
    }

    return 0
  }
}
