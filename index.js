const vm = require('vm');
const os = require('os');
const { ExtractGQL } = require('persistgraphql/lib/src/ExtractGQL');
const queryTransformers = require('persistgraphql/lib/src/queryTransformers');
const loadModuleRecursively = require('./load-module-recursively');
const { generateIdForQuery } = require('server/server-utils/graphql/persisted-queries');

module.exports = function persistedQueriesLoader(content) {
  const deps = [];
  const context = this;
  const sandbox = {
    require(file) {
      deps.push(new Promise((resolve, reject) => {
        loadModuleRecursively(context, file, (err, source, sourceMap, module) => {
          if (err) {
            reject(err);
          } else {
            resolve({ source, sourceMap, module });
          }
        });
      }));
      return { definitions: [] };
    },
    module: {
      exports: null
    }
  };
  vm.runInNewContext(content, sandbox);

  const doc = sandbox.module.exports;
  this._module._graphQLQuerySource = doc.loc.source.body;

  if (deps.length === 0) {
    content = tryAddDocumentId(content, this._module._graphQLQuerySource);
    return content;
  }

  const callback = this.async();

  Promise.all(deps).then((modules) => {
    modules.forEach((mod, index) => {
      this._module._graphQLQuerySource += mod.module._graphQLQuerySource;
    });

    try {
      content = tryAddDocumentId(content, this._module._graphQLQuerySource);
    } catch (e) {
      callback(e);
    }

    callback(null, content);
  }).catch((err) => {
    console.log('error', err);
    callback(err);
  });
};

function tryAddDocumentId(content, querySource) {
  const queryMap = new ExtractGQL({
    queryTransformers: [queryTransformers.addTypenameTransformer]
  }).createOutputMapFromString(querySource);

  const queries = Object.keys(queryMap);
  if (queries.length > 1) {
    throw new Error('Only one operation per file is allowed');
  } else if (queries.length === 1) {
    const queryId = generateIdForQuery(Object.keys(queryMap)[0]);
    content += `${os.EOL}doc.queryId = ${JSON.stringify(queryId)}`;
  }

  return content;
}
