import fs from 'node:fs';
import path from 'node:path';
import { openDwfDocument } from '../dist/index.js';

const input = process.argv[2] ?? 'examples/robot-arm.dwfx';
const abs = path.resolve(input);
const file = fs.readFileSync(abs);
const doc = await openDwfDocument(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const summary = {
  file: abs,
  kind: doc.kind,
  pages: doc.pages.length,
  pagesInfo: doc.pageData.map((p, i) => {
    if (p.kind === 'w3d-model') {
      return {
        page: i + 1,
        kind: p.kind,
        name: p.name,
        sourcePath: p.sourcePath,
        meshes: p.model.meshes.length,
        vertices: p.model.stats.vertexCount,
        triangles: p.model.stats.triangleCount,
        featureEdges: p.model.stats.edgeCount,
        materials: p.model.stats.materialCount,
        textures: p.model.stats.textureCount,
        sceneTreeNodes: p.model.stats.nodeCount,
        diagnostics: p.diagnostics.map(d => ({ level: d.level, code: d.code, message: d.message }))
      };
    }
    return {
      page: i + 1,
      kind: p.kind,
      name: p.name,
      sourcePath: p.sourcePath,
      diagnostics: p.diagnostics?.map(d => ({ level: d.level, code: d.code, message: d.message })) ?? []
    };
  })
};
console.log(JSON.stringify(summary, null, 2));
const modelPages = doc.pageData.filter(p => p.kind === 'w3d-model');
if (modelPages.length === 0) {
  console.error('No W3D model page was decoded.');
  process.exit(2);
}
