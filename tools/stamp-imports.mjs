// Keep one module identity throughout the graph, including multiline imports.
export function stampImports(source, query) {
  return source
    .replace(/((?:import|export)[^'";]*?\bfrom\s*['"])(\.{1,2}\/[^'"?]+)(['"])/g, `$1$2?${query}$3`)
    .replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"?]+)(['"]\s*\))/g, `$1$2?${query}$3`)
    .replace(/(import\s*['"])(\.{1,2}\/[^'"?]+)(['"])/g, `$1$2?${query}$3`);
}
