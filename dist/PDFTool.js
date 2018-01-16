'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PDFTool = undefined;

var _minimist = require('minimist');

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require('./version');

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _process = require('process');

var _process2 = _interopRequireDefault(_process);

var _temp = require('temp');

var _temp2 = _interopRequireDefault(_temp);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PDFTool {
  constructor(log) {
    this.log = log;
  }

  async run(argv) {
    const options = {
      boolean: ['help', 'version']
    };
    this.args = (0, _minimist2.default)(argv, options);

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    if (this.args.help) {
      this.log.info(`
usage: tool <cmd> [options]

options:
  --help                        Shows this help.
  --version                     Shows the tool version.
`);
      return 0;
    }

    return 0;
  }
}
exports.PDFTool = PDFTool;
//# sourceMappingURL=PDFTool.js.map