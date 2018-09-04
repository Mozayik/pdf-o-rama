# PDF-o-rama

This is a tool for manipulating PDF files.  With it you can do the following:

- Concatenate two or more PDF's into a single PDF file
- Strip the AcroForm and field annotations from a PDF
- Pull out AcroForm field information, and optionally strip the form data
- Generate a checksum for a stripped PDF file
- "Fill-in" a form by adding form elements at the specified rectangles of pages
- Watermark every page of a PDF with a given watermark PDF

The tool support a wide range of "field" types:

- Plain text (single line)
- Check boxes, with or without borders
- Highlighted fields
- Transparent signature labels
- QR codes

Additionally, the tool can embed a specific font into the PDF for use when filling out text fields.

## Installation

Install the tool with:

```
npm install -g KingstonSoftware/pdf-o-rama
pdf-o-rama help
```

or run it with `npx`:

```
npx KingstonSoftware/pdf-o-rama pdf-o-rama help
```
