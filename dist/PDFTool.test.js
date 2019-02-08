"use strict";

var _PDFTool = require("./PDFTool");

var _tmp = _interopRequireDefault(require("tmp"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

let tmpDirObj = null;
const toolName = "pdf-o-rama";
beforeAll(() => {
  tmpDirObj = _tmp.default.dirSync();
});
afterAll(() => {
  if (tmpDirObj) {
    tmpDirObj.removeCallback();
  }
});

function getMockLog() {
  return {
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
}

function getMockHummus() {
  return {
    createWriter: jest.fn(() => ({
      appendPDFPagesFromPDF: jest.fn(),
      end: jest.fn()
    }))
  };
}

function getMockFS() {
  return {
    existsSync: jest.fn(() => true)
  };
}

function getOutput(fn) {
  const calls = fn.mock.calls;

  if (calls.length > 0 && calls[0].length > 0) {
    return calls[0][0];
  } else {
    return "";
  }
}

test("--help", async done => {
  const mockLog = getMockLog();
  const tool = new _PDFTool.PDFTool(toolName, mockLog);
  const exitCode = await tool.run(["--help"]);
  expect(exitCode).toBe(0);
  expect(getOutput(mockLog.info)).toEqual(expect.stringContaining("--help"));
  done();
});
test("--version", async done => {
  const mockLog = getMockLog();
  const tool = new _PDFTool.PDFTool(toolName, mockLog);
  const exitCode = await tool.run(["--version"]);
  expect(exitCode).toBe(0);
  expect(getOutput(mockLog.info)).toEqual(expect.stringMatching(/\d\.\d\.\d/));
  done();
});
test("concat", async done => {
  const mockLog = getMockLog();
  const mockHummus = getMockHummus();
  const mockFS = getMockFS();
  const tool = new _PDFTool.PDFTool(toolName, mockLog, {
    hummus: mockHummus,
    fs: mockFS
  });
  await tool.concat({
    pdfFiles: ["a.pdf", "b.pdf"],
    outputFile: "x.pdf"
  });
  done();
});
//# sourceMappingURL=PDFTool.test.js.map