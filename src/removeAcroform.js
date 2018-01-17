export function removeAcroform(pdfWriter) {
  const reader = this.writer.getModifiedFileParser()
  let catalogDict = reader.queryDictionaryObject(reader.getTrailer(), 'Root').toPDFDictionary()
  let copyingContext = writer.createPDFCopyingContextForModifiedFile()
  let objectsContext = writer.getObjectsContext()

  const startModifiedDictionary = (originalDict, excludedKeys) => {
    let originalDictJs = originalDict.toJSObject()
    let newDict = objectsContext.startDictionary()

    Object.getOwnPropertyNames(originalDictJs).forEach((element) => {
      if (!excludedKeys.has(element)) {
        newDict.writeKey(element)
        copyingContext.copyDirectObjectAsIs(originalDictJs[element])
      }
    })

    return newDict
  }

  if (!catalogDict.exists('AcroForm')) {
    throw new Error('PDF does not have an AcroForm')
  }

  startModifiedDictionary(catalogDict, ['AcroForm'])
  objectsContext.endDictionary(modifiedAcroFormDict)
}
