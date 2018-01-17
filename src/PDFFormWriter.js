import hummus from 'hummus'
import * as Util from './util'
import autoBind from 'auto-bind2'

export class PDFFormWriter {
  constructor() {
    autoBind(this)
  }

  fillForm(pdfWriter, data) {
    this.data = data
    this.writer = pdfWriter
    this.reader = this.writer.getModifiedFileParser()

    let catalogDict = this.reader.queryDictionaryObject(this.reader.getTrailer(), 'Root').toPDFDictionary()

    if (!catalogDict.exists('AcroForm')) {
      throw new Error('PDF does not have an AcroForm')
    }

    this.acroformDict = this.reader.queryDictionaryObject(catalogDict, 'AcroForm')

    // setup copying context, and keep reference to objects context as well
    this.copyingContext = this.writer.createPDFCopyingContextForModifiedFile()
    this.objectsContext = this.writer.getObjectsContext()

    // recreate a copy of the existing form, which we will fill with data.
    if (this.acroformDict.getType() === hummus.ePDFObjectIndirectObjectReference) {
      // if the form is a referenced object, modify it
      this.objectsContext.startModifiedIndirectObject(this.acroformDict.toPDFIndirectObjectReference().getObjectID())
    } else {
      // otherwise, recreate the form as an indirect child (this is going to be a general policy,
      // we're making things indirect. it's simpler), and recreate the catalog
      let catalogObjectId = this.reader.getTrailer().queryObject('Root').toPDFIndirectObjectReference().getObjectID()
      let newAcroformObjectId = this.objectsContext.allocateNewObjectID()

      // recreate the catalog with form pointing to new reference
      this.objectsContext.startModifiedIndirectObject(catalogObjectId)

      const modifiedCatalogDictionary = this.startModifiedDictionary(catalogDict, {'AcroForm': -1})

      modifiedCatalogDictionary.writeKey('AcroForm')
      modifiedCatalogDictionary.writeObjectReferenceValue(newAcroformObjectId)
      this.objectsContext
        .endDictionary(modifiedCatalogDictionary)
        .endIndirectObject()

      // now create the new form object
      this.objectsContext.startNewIndirectObject(newAcroformObjectId)
    }

    let modifiedAcroFormDict = this.startModifiedDictionary(this.acroformDict, {'Fields': -1})

    let fields =
      this.acroformDict.exists('Fields') ?
      this.reader.queryDictionaryObject(this.acroformDict,'Fields').toPDFArray() :
      null

    if (fields) {
      modifiedAcroFormDict.writeKey('Fields')
      // will also take care of finishing the dictionary and indirect object, so no need to finish after
      this.writeFilledFields(modifiedAcroFormDict, fields,{},'');
    } else {
      this.objectsContext.endDictionary(modifiedAcroFormDict).objectsContext.endIndirectObject()
    }
  }

  startModifiedDictionary(originalDict, excludedKeys) {
    var originalDictJs = originalDict.toJSObject()
    var newDict = this.objectsContext.startDictionary()

    Object.getOwnPropertyNames(originalDictJs).forEach((element, index, array) => {
      if (!excludedKeys[element]) {
        newDict.writeKey(element)
        this.copyingContext.copyDirectObjectAsIs(originalDictJs[element])
      }
    })

    return newDict
  }

  defaultTerminalFieldWrite(fieldDictionary) {
    // default write of ending field. no reason to recurse to kids
    this.copyingContext
      .copyDirectObjectAsIs(fieldDictionary)
      .endIndirectObject()
  }

  /**
  * Update radio button value. look for the field matching the value, which should be an index.
  * Set its ON appearance as the value, and set all radio buttons appearance to off, but the selected one which should be on
  */
  updateOptionButtonValue(fieldDictionary, value) {
    let isWidget =  fieldDictionary.exists('Subtype') && (fieldDictionary.queryObject('Subtype').toString() == 'Widget')

    if (isWidget || ! fieldDictionary.exists('Kids')) {
      // this radio button has just one option and its in the widget. also means no kids
      let modifiedDict = this.startModifiedDictionary(fieldDictionary, {'V': -1, 'AS': -1})
      let appearanceName
      if (value === null) {
        // false is easy, just write '/Off' as the value and as the appearance stream
        appearanceName = 'Off'
      }
      else {
        // grab the non off value. that should be the yes one
        let apDictionary = this.reader.queryDictionaryObject(fieldDictionary,'AP').toPDFDictionary()
        let nAppearances = this.reader.queryDictionaryObject(apDictionary,'N').toPDFDictionary().toJSObject()
        appearanceName = Object.keys(nAppearances).find(item => (item !== 'Off'))
      }
      modifiedDict
        .writeKey('V')
        .writeNameValue(appearanceName)
        .writeKey('AS')
        .writeNameValue(appearanceName)

      this.objectsContext
        .endDictionary(modifiedDict)
        .endIndirectObject()
    } else {
      // Field. this would mean that there's a kid array, and there are offs and ons to set
      let modifiedDict = this.startModifiedDictionary(fieldDictionary, {'V': -1, 'Kids': -1})
      let kidsArray = this.reader.queryDictionaryObject(fieldDictionary,'Kids').toPDFArray()
      let appearaneName
      if (value === null) {
        // false is easy, just write '/Off' as the value and as the appearance stream
        appearanceName = 'Off'
      }
      else {
        // grab the non off value. that should be the yes one
        let widgetDictionary = this.reader.queryArrayObject(kidsArray,value).toPDFDictionary()
        let apDictionary = this.reader.queryDictionaryObject(widgetDictionary,'AP').toPDFDictionary()
        let nAppearances = this.reader.queryDictionaryObject(apDictionary,'N').toPDFDictionary().toJSObject()
        appearanceName = Object.keys(nAppearances).find(item => (item !== 'Off'))
      }

      // set the V value on the new field dictionary
      modifiedDict
        .writeKey('V')
        .writeNameValue(appearanceName)

      // write the kids array, similar to writeFilledFields, but knowing that these are widgets and that AS needs to be set
      let fieldsReferences = this.writeKidsAndEndObject(modifiedDict,kidsArray)

      // recreate widget kids, turn on or off based on their relation to the target value
      for(let i=0;i<fieldsReferences.length;++i) {
        let fieldReference = fieldsReferences[i]
        let sourceField

        if (fieldReference.existing) {
          this.objectsContext.startModifiedIndirectObject(fieldReference.id)
          sourceField = this.reader.parseNewObject(fieldReference.id).toPDFDictionary()
        } else {
          this.objectsContext.startNewIndirectObject(fieldReference.id)
          sourceField = fieldReference.field.toPDFDictionary()
        }

        let modifiedFieldDict = this.startModifiedDictionary(sourceField, {'AS': -1})
        if (value === i) {
          // this widget should be on
          modifiedFieldDict
            .writeKey('AS')
            .writeNameValue(appearanceName);  // note that we have saved it earlier
        }
        else {
          // this widget should be off
          modifiedFieldDict
            .writeKey('AS')
            .writeNameValue('Off')

        }
        // finish
        this.objectsContext
          .endDictionary(modifiedFieldDict)
          .endIndirectObject()
      }

    }
  }

  writeAppearanceXObjectForText(formId, fieldsDictionary, text, inheritedProperties) {
    let rect = this.reader.queryDictionaryObject(fieldsDictionary, 'Rect').toPDFArray().toJSArray()
    let da = fieldsDictionary.exists('DA') ? fieldsDictionary.queryObject('DA').toString() : inheritedProperties('DA')

    // register to copy resources from form default resources dict
    // It would be better to just refer to it...but alas don't have access for xobject resources dict
    if (this.acroformDict.exists('DR')) {
      this.writer.getEvents().once('OnResourcesWrite', (args) => {
        // copy all but the keys that exist already
        let dr = this.reader.queryDictionaryObject(this.acroformDict, 'DR').toPDFDictionary().toJSObject()
          Object.getOwnPropertyNames(dr).forEach((element, index, array) => {
            if (element !== 'ProcSet') {
              args.pageResourcesDictionaryContext.writeKey(element)
              this.copyingContext.copyDirectObjectAsIs(dr[element])
            }
          })
      })
    }

    let xobjectForm = this.writer.createFormXObject(
      0, 0, rect[2].value - rect[0].value, rect[3].value - rect[1].value, formId)

    // Will use Tj with "code" encoding to write the text, assuming encoding should work (??). if it won't i need real fonts here
    // and DA is not gonna be useful. so for now let's use as is.
    // For the same reason i'm not support Quad, as well.
    xobjectForm.getContentContext()
      .writeFreeCode('/Tx BMC\r\n')
      .q()
      .BT()
      .writeFreeCode(da + '\r\n')
      .Tj(text,{encoding:'code'})
      .ET()
      .Q()
      .writeFreeCode('EMC')
    this.writer.endFormXObject(xobjectForm)
  }

  writeFieldWithAppearanceForText(targetFieldDict, sourceFieldDictionary, appearanceInField, textToWrite, inheritedProperties) {
    // determine how to write appearance
    let newAppearanceFormId = this.objectsContext.allocateNewObjectID()
    if (appearanceInField) {
      // Appearance in field - so write appearance dict in field
      targetFieldDict
        .writeKey('AP')

      let apDict = this.objectsContext.startDictionary()
      apDict.writeKey("N").writeObjectReferenceValue(newAppearanceFormId)
      this.objectsContext
        .endDictionary(apDict)
        .endDictionary(targetFieldDict)
        .endIndirectObject()

    }
    else {
      // finish the field object
      this.objectsContext
        .endDictionary(targetFieldDict)
        .endIndirectObject()

      // write in kid (there should be just one)
      let kidsArray = this.reader.queryDictionaryObject(sourceFieldDictionary, 'Kids').toPDFArray()
      let fieldsReferences = this.writeKidsAndEndObject(targetFieldDict, kidsArray)

      // recreate widget kid, with new stream reference
      let fieldReference = fieldsReferences[0]

      if (fieldReference.existing) {
        this.objectsContext.startModifiedIndirectObject(fieldReference.id)
        sourceField = this.reader.parseNewObject(fieldReference.id).toPDFDictionary()
      } else {
        this.objectsContext.startNewIndirectObject(fieldReference.id)
        sourceField = fieldReference.field.toPDFDictionary()
      }

      let modifiedDict = this.startModifiedDictionary(sourceField, {'AP': -1})
      modifiedDict.writeKey('AP')

      let apDict = this.objectsContext.startDictionary()
      apDict.writeKey("N").writeObjectReferenceValue(newAppearanceFormId)
      this.objectsContext
        .endDictionary(apDict)
        .endDictionary(modifiedDict)
        .endIndirectObject()
    }

    // write the new stream xobject
    this.writeAppearanceXObjectForText(newAppearanceFormId, sourceFieldDictionary, textToWrite, inheritedProperties)
  }

  updateTextValue(fieldDictionary, value, isRich, inheritedProperties) {
    if (typeof(value) === 'string') {
      value = {v: value, rv: value}
    }

    let appearanceInField =  fieldDictionary.exists('Subtype') &&
      (fieldDictionary.queryObject('Subtype').toString() == 'Widget') || !fieldDictionary.exists('Kids')
    let fieldsToRemove = {'V': -1}

    if (appearanceInField) {
      // add skipping AP if in field (and not in a child widget)
      fieldsToRemove['AP'] = -1
    }
    if (isRich) {
      // skip RV if rich
      fieldsToRemove['RV'] = -1
    }

    let modifiedDict = this.startModifiedDictionary(fieldDictionary, fieldsToRemove)

    // Start with value, setting both plain value and rich value
    modifiedDict
      .writeKey('V')
      .writeLiteralStringValue(new hummus.PDFTextString(value['v']).toBytesArray())

    if (isRich) {
      modifiedDict
        .writeKey('RV')
        .writeLiteralStringValue(new hummus.PDFTextString(value['rv']).toBytesArray())
    }

    this.writeFieldWithAppearanceForText(modifiedDict, fieldDictionary, appearanceInField, value['v'], inheritedProperties)
  }

  updateChoiceValue(fieldDictionary,value,inheritedProperties) {
    let appearanceInField =  fieldDictionary.exists('Subtype') && (fieldDictionary.queryObject('Subtype').toString() == 'Widget') || !fieldDictionary.exists('Kids')
    let fieldsToRemove = {'V':-1}
    if (appearanceInField) {
      // add skipping AP if in field (and not in a child widget)
      fieldsToRemove['AP'] = -1
    }

    let modifiedDict = this.startModifiedDictionary(fieldDictionary, fieldsToRemove)

    // start with value, setting per one or multiple selection. also choose the text to write in appearance
    let textToWrite

    if (typeof(value) === 'string') {
      // one option
      modifiedDict
        .writeKey('V')
        .writeLiteralStringValue(new hummus.PDFTextString(value).toBytesArray())
      textToWrite = value
    }
    else {
      // multiple options
      modifiedDict
        .writeKey('V')
      this.objectsContext.startArray()
      value.forEach(function(singleValue) {
        this.objectsContext.writeLiteralString(new hummus.PDFTextString(singleValue).toBytesArray())
      })
      this.objectsContext.endArray()
      textToWrite = value.length > 0 ? value[0]:''
    }

    this.writeFieldWithAppearanceForText(modifiedDict,fieldDictionary,appearanceInField,textToWrite,inheritedProperties)
  }

  updateFieldWithValue(fieldDictionary, value, inheritedProperties) {
    // Update a field with value. There is a logical assumption made here:
    // This must be a terminal field. meaning it is a field, and it either has no kids, it also holding
    // Widget data or that it has one or more kids defining its widget annotation(s). Normally it would be
    // One but in the case of a radio button, where there's one per option.
    let localFieldType = fieldDictionary.exists('FT') ? fieldDictionary.queryObject('FT').toString() : undefined
    let fieldType = localFieldType || inheritedProperties['FT']
    let localFlags = fieldDictionary.exists('Ff') ? fieldDictionary.queryObject('Ff').toNumber() : undefined
    let localflags = localFlags === undefined ? inheritedProperties['Ff'] : localFlags

    // the rest is fairly type dependent, so let's check the type
    switch(fieldType) {
      case 'Btn': {
        if ((flags>>16) & 1)
        {
          // push button. can't write a value. forget it.
        this.defaultTerminalFieldWrite(fieldDictionary)
        }
        else
        {
          // checkbox or radio button
          this.updateOptionButtonValue(fieldDictionary, (flags>>15) & 1 ? value : (value ? 0:null))
        }
        break
      }
      case 'Tx': {
        // rich or plain text
        this.updateTextValue(fieldDictionary, value,(flags>>25) & 1, inheritedProperties)
        break
      }
      case 'Ch': {
        this.updateChoiceValue(fieldDictionary, value, inheritedProperties)
        break
      }
      case 'Sig': {
        // signature, ain't handling that. should return or throw an error sometimes
        this.defaultTerminalFieldWrite(fieldDictionary)
        break
      }
      default: {
        // in case there's a fault and there's no type, or it's irrelevant
        this.defaultTerminalFieldWrite(fieldDictionary)
      }
    }
  }

  writeFieldAndKids(fieldDictionary, inheritedProperties, baseFieldName) {
    // this field or widget doesn't need value rewrite. but its kids might.
    // so write the dictionary as is, dropping kids. write them later and recurse.

    let modifiedFieldDict = this.startModifiedDictionary(fieldDictionary, {'Kids': -1})
  // if kids exist, continue to them for extra filling!
    let kids = fieldDictionary.exists('Kids') ?
              this.reader.queryDictionaryObject(fieldDictionary,'Kids').toPDFArray() :
              null

    if (kids) {
      let localEnv = {}

      // prep some inherited values and push env
      if (fieldDictionary.exists('FT'))
        localEnv['FT'] = fieldDictionary.queryObject('FT').toString()
      if (fieldDictionary.exists('Ff'))
        localEnv['Ff'] = fieldDictionary.queryObject('Ff').toNumber()
      if (fieldDictionary.exists('DA'))
        localEnv['DA'] = fieldDictionary.queryObject('DA').toString()
      if (fieldDictionary.exists('Opt'))
        localEnv['Opt'] = fieldDictionary.queryObject('Opt').toPDFArray()

      modifiedFieldDict.writeKey('Kids')
      // recurse to kids. note that this will take care of ending this object
      this.writeFilledFields(modifiedFieldDict,kids, {...inheritedProperties, ...localEnv}, baseFieldName + '.')
    } else {
      // no kids, can finish object now
      this.objectsContext
        .endDictionary(modifiedFieldDict)
        .endIndirectObject()
    }
  }

  /**
  * writes a single field. will fill with value if found in data.
  * assuming that's in indirect object and having to write the dict,finish the dict, indirect object and write the kids
  */
  writeFilledField(fieldDictionary, inheritedProperties, baseFieldName) {
    let localFieldNameT = fieldDictionary.exists('T') ? Util.toText(fieldDictionary.queryObject('T')) : undefined
    let fullName = localFieldNameT === undefined ? baseFieldName : (baseFieldName + localFieldNameT)

    // Based on the fullName we can now determine whether the field has a value that needs setting
    if (this.data[fullName]) {
      // We got a winner! write with updated value
      this.updateFieldWithValue(fieldDictionary, this.data[fullName], inheritedProperties)
    }
    else {
      // Not yet. write and recurse to kids
      this.writeFieldAndKids(fieldDictionary, inheritedProperties, fullName)
    }
  }

  /**
  * Write kids array converting each direct kids to an indirect one
  */
  writeKidsAndEndObject(parentDict, kidsArray) {
    let fieldsReferences = []
    let fieldJSArray = kidsArray.toJSArray()

    this.objectsContext.startArray()
    fieldJSArray.forEach((field) => {
      if (field.getType() === hummus.ePDFObjectIndirectObjectReference) {
        // existing reference, keep as is
        this.copyingContext.copyDirectObjectAsIs(field)
        fieldsReferences.push({existing:true,id:field.toPDFIndirectObjectReference().getObjectID()})
      }
      else {
        let newFieldObjectId = this.objectsContext.allocateNewObjectID()
        // direct object, recreate as reference
        fieldsReferences.push({existing: false, id: newFieldObjectId, theObject: field})
        this.copyingContext.writeIndirectObjectReference(newFieldObjectId)
      }
    })
    this.objectsContext
      .endArray(hummus.eTokenSeparatorEndLine)
      .endDictionary(parentDict)
      .endIndirectObject()

    return fieldsReferences
  }

  /**
  * write fields/kids array of dictionary. make sure all become indirect, for the sake of simplicity,
  * which is why it gets to take care of finishing the writing of the said dict
  */
  writeFilledFields(parentDict, fields, inheritedProperties, baseFieldName) {
    let fieldsReferences = this.writeKidsAndEndObject(parentDict, fields)

    // now recreate the fields, filled this time (and down the recursion hole...)
    fieldsReferences.forEach((fieldReference) => {
      if (fieldReference.existing) {
        this.objectsContext.startModifiedIndirectObject(fieldReference.id)
        this.writeFilledField(
          this.reader.parseNewObject(fieldReference.id).toPDFDictionary(),inheritedProperties, baseFieldName)
      }
      else {
        this.objectsContext.startNewIndirectObject(fieldReference.id)
        this.writeFilledField(fieldReference.field.toPDFDictionary(), inheritedProperties, baseFieldName)
      }
    })
  }
}
