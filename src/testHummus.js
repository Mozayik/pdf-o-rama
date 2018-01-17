import hummus from 'hummus'

let pdfWriter = hummus.createWriter('hummus-file.pdf')
let page = pdfWriter.createPage(0, 0, 595, 842)
let arialFont = pdfWriter.getFontForFile('/Library/Fonts/Arial.ttf')
let ctx = pdfWriter.startPageContentContext(page)
const text = 'Test Page'
const textSize = 32
let textDims = arialFont.calculateTextDimensions(text, textSize)

ctx.writeText(text, (595 - textDims.width) / 2, (842 - textDims.height) / 2,
  { font: arialFont, size: textSize, color: 0x00 })

pdfWriter.writePage(page)
pdfWriter.end()
