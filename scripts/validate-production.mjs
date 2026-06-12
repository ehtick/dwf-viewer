import { readFile } from 'fs/promises';
import { openDwfDocument } from '../dist/index.js';

const targets = [
  { label: 'Autodesk Floor Plans DWFx A03', path: 'examples/autodesk-floor-plans.dwfx', pageIndex: 3, kind: 'xps-fixed-page', minPages: 18, maxNonInfoDiagnostics: 0 },
  { label: 'Robot Arm 3D DWFx', path: 'examples/robot-arm.dwfx', kind: 'w3d-model', minMeshes: 30, minTriangles: 40000, maxNonInfoDiagnostics: 0, maxPageDiagnostics: 0 },
  { label: '2D sample DWFx', path: 'examples/minimal-xps.dwfx', kind: 'xps-fixed-page' },
  { label: 'official binary W2D DWF', path: 'examples/blocks-and-tables.dwf', kind: 'w2d-text' }
];

let failed = false;
for (const t of targets) {
  const doc = await openDwfDocument(await readFile(t.path), { fileName: t.path });
  const page = doc.pageData[t.pageIndex ?? 0];
  const nonInfo = (page?.diagnostics ?? []).filter(d => d.level !== 'info');
  const record = {
    label: t.label,
    documentKind: doc.kind,
    pages: doc.pageData.length,
    pageIndex: t.pageIndex ?? 0,
    pageKind: page?.kind,
    pageName: page?.name,
    meshes: page?.kind === 'w3d-model' ? page.model.meshes.length : undefined,
    triangles: page?.kind === 'w3d-model' ? page.model.stats.triangleCount : undefined,
    nonInfoDiagnostics: nonInfo.length,
    diagnostics: nonInfo
  };
  console.log(JSON.stringify(record, null, 2));
  if (!page || page.kind !== t.kind) failed = true;
  if (typeof t.minPages === 'number' && doc.pageData.length < t.minPages) failed = true;
  if (typeof t.minMeshes === 'number' && (!(page?.kind === 'w3d-model') || page.model.meshes.length < t.minMeshes)) failed = true;
  if (typeof t.minTriangles === 'number' && (!(page?.kind === 'w3d-model') || page.model.stats.triangleCount < t.minTriangles)) failed = true;
  if (typeof t.maxNonInfoDiagnostics === 'number' && nonInfo.length > t.maxNonInfoDiagnostics) failed = true;
  if (typeof t.maxPageDiagnostics === 'number' && (page?.diagnostics?.length ?? 0) > t.maxPageDiagnostics) failed = true;
}
if (failed) process.exit(1);
