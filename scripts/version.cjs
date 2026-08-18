// Prints the package version — used by the Makefile's VERSION variable.
const pkg = require('../package.json');
console.log(pkg.version);
