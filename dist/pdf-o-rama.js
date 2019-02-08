#!/usr/bin/env node
"use strict";

var _PDFTool = require("./PDFTool");

var _chalk = _interopRequireDefault(require("chalk"));

var _path = _interopRequireDefault(require("path"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const log = {
  info: function () {
    console.error(_chalk.default.green([...arguments].join(" ")));
  },
  error: function () {
    console.error(_chalk.default.red("error:", [...arguments].join(" ")));
  },
  warning: function () {
    console.error(_chalk.default.yellow("warning:", [...arguments].join(" ")));
  }
};
const tool = new _PDFTool.PDFTool(_path.default.basename(process.argv[1], ".js"), log);
tool.run(process.argv.slice(2)).then(exitCode => {
  process.exitCode = exitCode;
}).catch(err => {
  log.error(err.message);

  if (tool.debug) {
    console.error(err);
  }
});
//# sourceMappingURL=pdf-o-rama.js.map