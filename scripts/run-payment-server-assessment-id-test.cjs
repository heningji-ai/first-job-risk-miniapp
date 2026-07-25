const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return request.startsWith("@/")
    ? resolve.call(this, path.join(process.cwd(), "src", request.slice(2)), parent, isMain, options)
    : resolve.call(this, request, parent, isMain, options);
};

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/api/request" || String(request).replaceAll("\\", "/").endsWith("/src/api/request.ts")) {
    return {
      ApiError: class ApiError extends Error {},
      request: () => Promise.reject(new Error("unconfigured request")),
    };
  }
  return load.call(this, request, parent, isMain);
};

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.env.DEV", "false");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  });
  module._compile(output.outputText, filename);
};

require("./test-payment-server-assessment-id.ts");
