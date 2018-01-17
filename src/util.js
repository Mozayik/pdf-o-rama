import hummus from 'hummus'

export function toText(item) {
  if(item.getType() === hummus.ePDFObjectLiteralString) {
    return item.toPDFLiteralString().toText()
  }
  else if(item.getType() === hummus.ePDFObjectHexString) {
    return item.toPDFHexString().toText()
  } else {
    return item.value
  }
}
