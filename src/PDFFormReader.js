import hummus from 'hummus'
import * as Util from './util'
import autoBind from 'auto-bind2'

export class PDFFormReader {
  constructor() {
    autoBind(this)
  }

  readFormFields(pdfReader) {
    this.pdfReader = pdfReader

    const catalogDict = this.pdfReader.queryDictionaryObject(this.pdfReader.getTrailer(), 'Root').toPDFDictionary()

    if (!catalogDict.exists('AcroForm')) {
      throw new Error('PDF does not have an AcroForm')
    }

    this.acroformDict = this.pdfReader.queryDictionaryObject(catalogDict, 'AcroForm').toPDFDictionary()

    let fieldsArray = this.acroformDict.exists('Fields') ?
      this.pdfReader.queryDictionaryObject(this.acroformDict, 'Fields').toPDFArray() :
      null

    if (!fieldsArray) {
      return null
    }

    const numPages = pdfReader.getPagesCount()

    this.pageMap = {}
    for (let i = 0; i < numPages; i++) {
      this.pageMap[pdfReader.getPageObjectID(i)] = i
    }
    
    return this.parseFieldsArray(fieldsArray, {}, '')
  }

  parseKids(fieldDictionary, inheritedProperties, baseFieldName) {
    let localEnv = {}

    // prep some inherited values and push env
    if (fieldDictionary.exists('FT')) {
      localEnv['FT'] = fieldDictionary.queryObject('FT').toString()
    }
    if (fieldDictionary.exists('Ff')) {
      localEnv['Ff'] = fieldDictionary.queryObject('Ff').toNumber()
    }
    if (fieldDictionary.exists('DA')) {
      localEnv['DA'] = Util.toText(fieldDictionary.queryObject('DA'))
    }
    if (fieldDictionary.exists('Opt')) {
      localEnv['Opt'] = fieldDictionary.queryObject('Opt').toPDFArray()
    }

    // parse kids
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
      return Util.toText(valueField)
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
        return Util.toText(valueField)
      } else if (valueField.getType == hummus.ePDFObjectArray) {
        let arrayOfStrings = valueField.toPDFArray().toJSArray()
        return arrayOfStrings.map(Util.toText)
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
        result['isFileSelect'] = !!(flags>>20 & 1)
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
    let fieldNameT = fieldDictionary.exists('T') ? Util.toText(fieldDictionary.queryObject('T')) : undefined
    let fieldNameTU = fieldDictionary.exists('TU') ? Util.toText(fieldDictionary.queryObject('TU')) : undefined
    let fieldNameTM = fieldDictionary.exists('TM') ? Util.toText(fieldDictionary.queryObject('TM')) : undefined
    let fieldFlags = fieldDictionary.exists('Ff') ? fieldDictionary.queryObject('Ff').toNumber() : undefined
    let fieldRect = fieldDictionary.exists('Rect') ? fieldDictionary.queryObject('Rect').toPDFArray().toJSArray() : undefined
    let fieldP = fieldDictionary.exists('P') ? fieldDictionary.queryObject('P').toPDFIndirectObjectReference().getObjectID() : undefined

    fieldFlags = (fieldFlags === undefined ? inheritedProperties['Ff'] : fieldFlags)
    fieldFlags = fieldFlags || 0

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
      alternateName: fieldNameTU,
      mappingName: fieldNameTM,
      isNoExport: !!((fieldFlags>>2) & 1),
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

    if (result.length == 0) {
      return null
    } else {
      return result
    }
  }
}
