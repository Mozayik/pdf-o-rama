"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PDFTool = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _class;

var _minimist = require("minimist");

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require("./version");

var _path = require("path");

var _path2 = _interopRequireDefault(_path);

var _fs = require("fs");

var _fs2 = _interopRequireDefault(_fs);

var _process = require("process");

var _process2 = _interopRequireDefault(_process);

var _tmpPromise = require("tmp-promise");

var _tmpPromise2 = _interopRequireDefault(_tmpPromise);

var _hummus = require("hummus");

var _hummus2 = _interopRequireDefault(_hummus);

var _util = require("util");

var _util2 = _interopRequireDefault(_util);

var _json = require("json5");

var _json2 = _interopRequireDefault(_json);

var _qrcode = require("qrcode");

var _qrcode2 = _interopRequireDefault(_qrcode);

var _md = require("md5");

var _md2 = _interopRequireDefault(_md);

var _autobindDecorator = require("autobind-decorator");

var _autobindDecorator2 = _interopRequireDefault(_autobindDecorator);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

_fs2.default.readFileAsync = _util2.default.promisify(_fs2.default.readFile);
_fs2.default.writeFileAsync = _util2.default.promisify(_fs2.default.writeFile);

function toText(item) {
  if (item.getType() === _hummus2.default.ePDFObjectLiteralString) {
    return item.toPDFLiteralString().toText();
  } else if (item.getType() === _hummus2.default.ePDFObjectHexString) {
    return item.toPDFHexString().toText();
  } else {
    return item.value;
  }
}

let PDFTool = exports.PDFTool = (0, _autobindDecorator2.default)(_class = class PDFTool {
  constructor(toolName, log) {
    this.toolName = toolName;
    this.log = log;
  }

  async run(argv) {
    const options = {
      string: ["output-file", "watermark-file", "data-file", "font-file"],
      boolean: ["help", "version", "checkbox-borders"],
      alias: {
        o: "output-file",
        w: "watermark-file",
        d: "data-file",
        f: "font-file",
        c: "checkbox-borders"
      }
    };

    this.args = (0, _minimist2.default)(argv, options);

    let command = "help";

    if (this.args._.length > 0) {
      command = this.args._[0].toLowerCase();
      this.args._.shift();
    }

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    switch (command) {
      case "concat":
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} concat <pdf1> <pdf2> [<pdf3> ...] [options]

Options:
  --output-file, -o  Output PDF file

Notes:
  File will be concatenated in the order in which they are given.
`);
          return 0;
        }
        return await this.concat();
      case "fields":
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} fields <pdf>

Options:
--data-file, -d         Output JSON file
--output-file, -o       Optional output PDF stripped of AcroForm and annotations.
                        Adds 'md5' field to the output JSON.

Notes:
Outputs a JSON file containing information for all the AcroForm fields in the document.
If an output file is specified a stripped PDF will be generated (see 'strip' command)
and an MD5 hash for the file will be included in the data file.
`);
          return 0;
        }
        return await this.fields();
      case "strip":
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} strip <pdf> [options]

Options:
  --output-file, -o    Output PDF file

Notes:
Strips any AcroForm and page annotations from the document.
`);
          return 0;
        }
        return await this.strip();
      case "watermark":
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} watermark <pdf> [options]

Options:
  --watermark-file , -w   Watermarked PDF document
  --output-file, -o       Output PDF file

Notes:
Adds a watermark images to the existing content of each page of the given PDF.
`);
          return 0;
        }
        return await this.watermark();
      case "fill":
        if (this.args.help) {
          this.log.info(`
Usage: ${this.toolName} fill <pdf> [options]

Options:
--output-file, -o       Output PDF file
--data-file, -d         Input JSON/JSON5 data file
--font-file, -f         Input font file name to use for text fields
--checkbox-borders, -c  Put borders around checkboxes

Notes:
Inserts 'form' data into the pages of the PDF.
`);
          return 0;
        }
        return await this.fill();
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
`);
        return 0;
      default:
        this.log.error(`Unknown command ${command}.  Use --help to see available commands`);
        return -1;
    }

    return 0;
  }

  async concat() {
    const fileNames = this.args._;

    if (fileNames.length < 2) {
      this.log.error("Must specify at least two PDF files to concatenate");
      return -1;
    }

    for (let fileName of fileNames) {
      if (!_fs2.default.existsSync(fileName)) {
        this.log.error(`File '${fileName}' does not exist`);
        return -1;
      }
    }

    const outputFile = this.args["output-file"];

    if (!outputFile) {
      this.log.error("No output file specified");
      return -1;
    }

    const pdfWriter = _hummus2.default.createWriter(outputFile);

    for (let fileName of fileNames) {
      pdfWriter.appendPDFPagesFromPDF(fileName);
    }

    pdfWriter.end();
  }

  async fields() {
    const fileName = this.args._[0];

    if (!fileName) {
      this.log.error("Must specify a PDF from which to extract information");
      return -1;
    }

    if (!_fs2.default.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`);
      return -1;
    }

    const dataFileName = this.args["data-file"];

    if (!dataFileName) {
      this.log.error(`No output data file specified`);
      return -1;
    }

    const outputFileName = this.args["output-file"];

    this.pdfReader = _hummus2.default.createReader(fileName);

    const catalogDict = this.pdfReader.queryDictionaryObject(this.pdfReader.getTrailer(), "Root").toPDFDictionary();

    if (!catalogDict.exists("AcroForm")) {
      this.log.error("PDF does not have an AcroForm");
      return -1;
    }

    this.acroformDict = this.pdfReader.queryDictionaryObject(catalogDict, "AcroForm").toPDFDictionary();

    let fieldsArray = this.acroformDict.exists("Fields") ? this.pdfReader.queryDictionaryObject(this.acroformDict, "Fields").toPDFArray() : null;

    // Page map is used to get page number from page object ID
    const numPages = this.pdfReader.getPagesCount();

    this.pageMap = {};
    for (let i = 0; i < numPages; i++) {
      this.pageMap[this.pdfReader.getPageObjectID(i)] = i;
    }

    let fieldData = {};

    fieldData.numPages = numPages;
    fieldData.fields = this.parseFieldsArray(fieldsArray, {}, "");

    if (outputFileName) {
      await this.stripAcroFormAndAnnotations(fileName, outputFileName);
      const buf = await _fs2.default.readFileAsync(outputFileName);
      fieldData.md5 = (0, _md2.default)(buf.buffer);
    }

    await _fs2.default.writeFileAsync(dataFileName, JSON.stringify(fieldData, undefined, "  "));

    return 0;
  }

  startModifiedDictionaryExcluding(originalDict, excludedKeys) {
    let originalDictJS = originalDict.toJSObject();
    let newDict = this.objectsContext.startDictionary();

    Object.getOwnPropertyNames(originalDictJS).forEach(element => {
      if (!excludedKeys.includes(element)) {
        newDict.writeKey(element);
        this.copyingContext.copyDirectObjectAsIs(originalDictJS[element]);
      }
    });

    return newDict;
  }

  async strip() {
    const fileName = this.args._[0];

    if (!fileName) {
      this.log.error("Must specify a PDF from which to remove the AcroForm");
      return -1;
    }

    if (!_fs2.default.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`);
      return -1;
    }

    const outputFileName = this.args["output-file"];

    if (!outputFileName) {
      this.log.error(`No output file specified`);
      return -1;
    }

    await this.stripAcroFormAndAnnotations(fileName, outputFileName);

    return 0;
  }

  async stripAcroFormAndAnnotations(fileName, outputFileName) {
    // This strips the AcroForm and page annotations as a side-effect
    // merging them into a new page.
    const pdfWriter = _hummus2.default.createWriter(outputFileName);
    const pdfReader = _hummus2.default.createReader(fileName);
    const copyingContext = pdfWriter.createPDFCopyingContext(pdfReader);

    // Next, iterate through the pages from the source document
    const numPages = pdfReader.getPagesCount();

    for (let i = 0; i < numPages; i++) {
      const page = pdfReader.parsePage(i);
      const pageMediaBox = page.getMediaBox();
      const newPage = pdfWriter.createPage(...pageMediaBox);

      // Merge the page; this will also remove annotations.
      copyingContext.mergePDFPageToPage(newPage, i);
      pdfWriter.writePage(newPage);
    }

    pdfWriter.end();
  }

  async fill() {
    const fileName = this.args._[0];

    if (!fileName) {
      this.log.error("Must specify an input PDF file");
      return -1;
    }

    if (!_fs2.default.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`);
      return -1;
    }

    const outputFileName = this.args["output-file"];

    if (!outputFileName) {
      this.log.error("No output file specified");
      return -1;
    }

    const jsonFileName = this.args["data-file"];

    if (!jsonFileName) {
      this.log.error("Must specify a data file");
      return -1;
    }

    if (!_fs2.default.existsSync(jsonFileName)) {
      this.log.error(`File '${jsonFileName}' does not exist`);
      return -1;
    }

    const fontFileName = this.args["font-file"];
    const checkboxBorders = !!this.args["checkbox-borders"];

    let data = null;

    try {
      data = await _json2.default.parse((await _fs2.default.readFileAsync(jsonFileName, { encoding: "utf8" })));
    } catch (e) {
      this.log.error(`Unable to read data file '${jsonFileName}'. ${e.message}`);
      return -1;
    }

    if (data.md5) {
      const buf = await _fs2.default.readFileAsync(fileName);

      if ((0, _md2.default)(buf.buffer) !== data.md5) {
        this.log.error(`MD5 for ${fileName} does not match the one in the data file`);
        return -1;
      }
    }

    this.pdfWriter = _hummus2.default.createWriterToModify(fileName, {
      modifiedFilePath: outputFileName
    });
    this.pdfReader = this.pdfWriter.getModifiedFileParser();

    let font = null;
    let fontDims = null;

    if (fontFileName) {
      font = this.pdfWriter.getFontForFile(fontFileName);
      fontDims = font.calculateTextDimensions("X", 14);
    }

    const catalogDict = this.pdfReader.queryDictionaryObject(this.pdfReader.getTrailer(), "Root").toPDFDictionary();

    if (catalogDict.exists("AcroForm")) {
      this.log.warning("PDF still has an AcroForm");
    }

    const numPages = this.pdfReader.getPagesCount();

    for (let i = 0; i < numPages; i++) {
      const page = this.pdfReader.parsePage(i);
      const pageModifier = new _hummus2.default.PDFPageModifier(this.pdfWriter, 0);
      let pageContext = pageModifier.startContext().getContext();
      const fields = data.fields.filter(f => f.page === i);

      for (let field of fields) {
        const x = field.rect[0];
        const y = field.rect[1];
        const w = field.rect[2] - x;
        const h = field.rect[3] - y;
        const rise = h / 4.0;
        const halfH = h / 2;

        switch (field.type) {
          case "highlight":
            pageContext.q().rg(1, 1, 0.6).re(x, y, w, h).f().Q();
            break;
          case "plaintext":
            if (!font) {
              this.log.error("Font file must be specified for plaintext fields");
              return -1;
            }
            pageContext.q().BT().g(0).Tm(1, 0, 0, 1, x, y + rise).Tf(font, 14).Tj(field.value).ET().Q();
            break;
          case "qrcode":
            const pngFileName = await _tmpPromise2.default.tmpName({ postfix: ".png" });

            await _qrcode2.default.toFile(pngFileName, field.value);

            pageModifier.endContext();
            let imageXObject = this.pdfWriter.createFormXObjectFromPNG(pngFileName);
            pageContext = pageModifier.startContext().getContext();

            pageContext.q().cm(1, 0, 0, 1, x, y).doXObject(imageXObject).Q();

            _fs2.default.unlinkSync(pngFileName);
            break;
          case "checkbox":
            pageContext.q().G(0).w(2.5);

            if (checkboxBorders) {
              pageContext.J(2).re(x, y, w, h).S();
            }

            if (!!field.value) {
              const dx = w / 5.0;
              const dy = h / 5.0;

              pageContext.J(1).m(x + dx, y + dy).l(x + w - dx, y + h - dy).S().m(x + dx, y + h - dy).l(x + w - dy, y + dy).S();
            }

            pageContext.Q();
            break;
          case "signhere":
            if (!font) {
              this.log.error("Font file must be specified for signhere fields");
              return -1;
            }

            const q = Math.PI / 4.0;

            pageModifier.endContext();

            let gsID = this.createOpacityExtGState(0.5);
            let formXObject = this.pdfWriter.createFormXObject(0, 0, w, h);
            let gsName = formXObject.getResourcesDictionary().addExtGStateMapping(gsID);

            formXObject.getContentContext().q().gs(gsName).w(1.0).G(0).rg(1, 0.6, 1).m(0, halfH).l(halfH, 0).l(w, 0).l(w, h).l(halfH, h).h().B().BT().g(0).Tm(1, 0, 0, 1, halfH, halfH - fontDims.height / 2.0).Tf(font, 12).Tj(`Sign Here ${field.value}`).ET().Q();
            this.pdfWriter.endFormXObject(formXObject);

            pageContext = pageModifier.startContext().getContext();

            pageContext.q().cm(1, 0, 0, 1, x, y + halfH).cm(Math.cos(q), Math.sin(q), -Math.sin(q), Math.cos(q), 0, 0).cm(1, 0, 0, 1, 0, -halfH)
            // NOTE: The coordinate space of the XObjects is the same as the page!
            .doXObject(formXObject).Q();
            break;
          default:
            this.log.warning(`Unknown field type ${field.type}`);
            break;
        }
      }

      pageModifier.endContext().writePage();
    }

    this.pdfWriter.end();
  }

  createOpacityExtGState(opacity) {
    const context = this.pdfWriter.getObjectsContext();
    const id = context.startNewIndirectObject();
    const dict = context.startDictionary();

    dict.writeKey("type").writeNameValue("ExtGState").writeKey("ca");
    context.writeNumber(opacity).endLine();
    dict.writeKey("CA");
    context.writeNumber(opacity).endLine().endDictionary(dict);

    return id;
  }

  async watermark() {
    const fileName = this.args._[0];

    if (!fileName) {
      this.log.error("Must specify a PDF from which to remove the AcroForm");
      return -1;
    }

    if (!_fs2.default.existsSync(fileName)) {
      this.log.error(`File '${fileName}' does not exist`);
      return -1;
    }

    const watermarkFileName = this.args["watermark-file"];

    if (!watermarkFileName) {
      this.log.error("No watermark file specified");
      return -1;
    }

    if (!_fs2.default.existsSync(watermarkFileName)) {
      this.log.error(`File '${watermarkFileName}' does not exist`);
      return -1;
    }

    const outputFileName = this.args["output-file"];

    if (!outputFileName) {
      this.log.error("No output file specified");
      return -1;
    }

    this.pdfWriter = _hummus2.default.createWriter(outputFileName);
    this.pdfReader = _hummus2.default.createReader(fileName);
    const copyingContext = this.pdfWriter.createPDFCopyingContext(this.pdfReader);

    // First, read in the watermark PDF and create a
    const watermarkInfo = this.getPDFPageInfo(watermarkFileName, 0);

    const formIDs = this.pdfWriter.createFormXObjectsFromPDF(watermarkFileName, _hummus2.default.ePDFPageBoxMediaBox);

    // Next, iterate through the pages from the source document
    const numPages = this.pdfReader.getPagesCount();

    for (let i = 0; i < numPages; i++) {
      const page = this.pdfReader.parsePage(i);
      const pageMediaBox = page.getMediaBox();
      const newPage = this.pdfWriter.createPage(...pageMediaBox);

      // Merge the page; this will also remove annotations.
      copyingContext.mergePDFPageToPage(newPage, i);

      const pageContext = this.pdfWriter.startPageContentContext(newPage);

      pageContext.q().cm(1, 0, 0, 1, (pageMediaBox[2] - watermarkInfo.mediaBox[2]) / 2, (pageMediaBox[3] - watermarkInfo.mediaBox[3]) / 2).doXObject(newPage.getResourcesDictionary().addFormXObjectMapping(formIDs[0])).Q();

      this.pdfWriter.writePage(newPage);
    }

    this.pdfWriter.end();
    return 0;
  }

  getPDFPageInfo(fileName, pageNum) {
    const pdfReader = _hummus2.default.createReader(fileName);
    const page = pdfReader.parsePage(pageNum);

    return {
      mediaBox: page.getMediaBox()
    };
  }

  parseKids(fieldDictionary, inheritedProperties, baseFieldName) {
    let localEnv = {};

    if (fieldDictionary.exists("FT")) {
      localEnv["FT"] = fieldDictionary.queryObject("FT").toString();
    }
    if (fieldDictionary.exists("Ff")) {
      localEnv["Ff"] = fieldDictionary.queryObject("Ff").toNumber();
    }
    if (fieldDictionary.exists("DA")) {
      localEnv["DA"] = toText(fieldDictionary.queryObject("DA"));
    }
    if (fieldDictionary.exists("Opt")) {
      localEnv["Opt"] = fieldDictionary.queryObject("Opt").toPDFArray();
    }

    let result = this.parseFieldsArray(this.pdfReader.queryDictionaryObject(fieldDictionary, "Kids").toPDFArray(), _extends({}, inheritedProperties, localEnv), baseFieldName);

    return result;
  }

  parseOnOffValue(fieldDictionary) {
    if (fieldDictionary.exists("V")) {
      let value = fieldDictionary.queryObject("V").toString();
      if (value === "Off" || value === "") {
        return false;
      } else {
        return true;
      }
    } else {
      return null;
    }
  }

  parseRadioButtonValue(fieldDictionary) {
    if (fieldDictionary.exists("V")) {
      let value = fieldDictionary.queryObject("V").toString();

      if (value === "Off" || value === "") {
        return null;
      } else {
        // using true cause sometimes these are actually checkboxes, and there's no underlying kids
        let result = true;
        // for radio button this would be an appearance name of a radio button that's turned on. we wanna look for it
        if (fieldDictionary.exists("Kids")) {
          let kidsArray = this.pdfReader.queryDictionaryObject(fieldDictionary, "Kids").toPDFArray();

          for (let i = 0; i < kidsArray.getLength(); ++i) {
            let widgetDictionary = this.pdfReader.queryArrayObject(kidsArray, i).toPDFDictionary();
            // use the dictionary Ap/N dictionary for looking up the appearance stream name
            let apDictionary = this.pdfReader.queryDictionaryObject(widgetDictionary, "AP").toPDFDictionary();
            let nAppearances = this.pdfReader.queryDictionaryObject(apDictionary, "N").toPDFDictionary();

            if (nAppearances.exists(value)) {
              // Found!
              result = i; // save the selected index as value
              break;
            }
          }
        }

        return result;
      }
    } else {
      return null;
    }
  }

  parseTextFieldValue(fieldDictionary, fieldName) {
    // grab field value, may be either a text string or a text stream
    if (!fieldDictionary.exists(fieldName)) {
      return null;
    }

    let valueField = this.pdfReader.queryDictionaryObject(fieldDictionary, fieldName);

    if (valueField.getType() == _hummus2.default.ePDFObjectLiteralString) {
      return toText(valueField);
    } else if (valueField.getType() == _hummus2.default.ePDFObjectStream) {
      let bytes = [];
      let readStream = pdfReader.startReadingFromStream(valueField.toPDFStream());

      while (readStream.notEnded()) {
        const readData = readStream.read(1);
        // do something with the data
        bytes.push(readData[0]);
      }
      return new PDFTextString(bytes).toString();
    } else {
      return null;
    }
  }

  parseChoiceValue(fieldDictionary) {
    if (fieldDictionary.exists("V")) {
      let valueField = this.pdfReader.queryDictionaryObject(fieldDictionary, "V");

      if (valueField.getType() == _hummus2.default.ePDFObjectLiteralString || valueField.getType() == _hummus2.default.ePDFObjectHexString) {
        // text string. read into value
        return toText(valueField);
      } else if (valueField.getType == _hummus2.default.ePDFObjectArray) {
        let arrayOfStrings = valueField.toPDFArray().toJSArray();
        return arrayOfStrings.map(toText);
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  parseFieldsValueData(result, fieldDictionary, flags, inheritedProperties) {
    const localFieldType = fieldDictionary.exists("FT") ? fieldDictionary.queryObject("FT").toString() : undefined;
    const fieldType = localFieldType || inheritedProperties["FT"];

    if (!fieldType) {
      return null; // k. must be a widget
    }

    switch (fieldType) {
      case "Btn":
        {
          if (flags >> 16 & 1) {
            // push button
            result["type"] = "button";
            // no value
          } else if (flags >> 15 & 1) {
            // radio button
            result["type"] = "radio";
            result["value"] = this.parseRadioButtonValue(fieldDictionary);
          } else {
            // checkbox
            result["type"] = "checkbox";
            result["value"] = this.parseOnOffValue(fieldDictionary);
          }
          break;
        }
      case "Tx":
        {
          // result['isFileSelect'] = !!(flags>>20 & 1)
          if (flags >> 25 & 1) {
            result["type"] = "richtext";
            // rich text, value in 'RV'
            result["value"] = this.parseTextFieldValue(fieldDictionary, "RV");
            result["plainValue"] = this.parseTextFieldValue(fieldDictionary, "V");
          } else {
            result["type"] = "plaintext";
            result["value"] = this.parseTextFieldValue(fieldDictionary, "V");
          }

          break;
        }
      case "Ch":
        {
          result["type"] = "choice";
          result["value"] = this.parseChoiceValue(fieldDictionary);
          break;
        }
      case "Sig":
        {
          result["type"] = "signature";
          break;
        }
    }
  }

  parseField(fieldDictionary, inheritedProperties, baseFieldName) {
    let fieldNameT = fieldDictionary.exists("T") ? toText(fieldDictionary.queryObject("T")) : undefined;
    let fieldNameTU = fieldDictionary.exists("TU") ? toText(fieldDictionary.queryObject("TU")) : undefined;
    let fieldNameTM = fieldDictionary.exists("TM") ? toText(fieldDictionary.queryObject("TM")) : undefined;
    let fieldFlags = fieldDictionary.exists("Ff") ? fieldDictionary.queryObject("Ff").toNumber() : undefined;
    let fieldRect = fieldDictionary.exists("Rect") ? fieldDictionary.queryObject("Rect").toPDFArray().toJSArray() : undefined;
    let fieldP = fieldDictionary.exists("P") ? fieldDictionary.queryObject("P").toPDFIndirectObjectReference().getObjectID() : undefined;

    fieldFlags = fieldFlags === undefined ? inheritedProperties["Ff"] : fieldFlags;
    fieldFlags = fieldFlags || 0;

    if (fieldRect) {
      fieldRect = fieldRect.map(r => r.value);
    }

    // Assume that if there's no T and no Kids, this is a widget annotation which is not a field
    if (fieldNameT === undefined && !fieldDictionary.exists("Kids") && fieldDictionary.exists("Subtype") && fieldDictionary.queryObject("Subtype").toString() == "Widget") {
      return null;
    }

    let result = {
      name: fieldNameT,
      fullName: fieldNameT === undefined ? undefined : baseFieldName + fieldNameT,
      //alternateName: fieldNameTU,
      //mappingName: fieldNameTM,
      //isNoExport: !!((fieldFlags>>2) & 1),
      rect: fieldRect,
      page: this.pageMap[fieldP]
    };

    if (fieldDictionary.exists("Kids")) {
      let kids = this.parseKids(fieldDictionary, inheritedProperties, baseFieldName + fieldNameT + ".");

      if (kids) {
        // that would be a non terminal node, otherwise all kids are annotations an null would be returned
        result["kids"] = kids;
      } else {
        // a terminal node, so kids array returned empty
        this.parseFieldsValueData(result, fieldDictionary, fieldFlags, inheritedProperties);
      }
    } else {
      // read fields value data
      this.parseFieldsValueData(result, fieldDictionary, fieldFlags, inheritedProperties);
    }

    return result;
  }

  parseFieldsArray(fieldsArray, inheritedProperties, baseFieldName) {
    let result = [];

    for (let i = 0; i < fieldsArray.getLength(); ++i) {
      let fieldResult = this.parseField(this.pdfReader.queryArrayObject(fieldsArray, i).toPDFDictionary(), inheritedProperties, baseFieldName);

      if (fieldResult) {
        result.push(fieldResult);
      }
    }

    return result;
  }
}) || _class;
//# sourceMappingURL=PDFTool.js.map