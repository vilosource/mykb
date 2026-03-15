// Loader that imports the compiled extension from the mounted dist directory
const ext = await import("/home/node/.pi/agent/extensions/mykb-dist/extension/index.js");
export default ext.default;
