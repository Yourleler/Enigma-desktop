import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactPresentation, artifactDownloadName, artifactContentDisposition } from '../src/artifact-presentation.js';
import type { ArtifactRecord } from '../src/artifacts.js';
const record = { id: 'artifact-example', kind: 'screenshot', extension: '.png', origin: { file: 'images/接口截图.png' } } as ArtifactRecord;
test('artifact preview uses actual raster signatures and downloads retain the original filename', () => {
  const jpeg = artifactPresentation(record, Buffer.from([255,216,255,224,0,4]));
  assert.equal(jpeg.kind, 'image'); assert.equal(jpeg.mediaType, 'image/jpeg');
  const png = artifactPresentation(record, Buffer.from([137,80,78,71,13,10,26,10])); assert.equal(png.mediaType, 'image/png');
  assert.equal(artifactDownloadName(record), '接口截图.png');
  assert.match(artifactContentDisposition(record), /filename="artifact-example.png"; filename\*=UTF-8''%/);
  const unsafe = { ...record, origin: { file: 'dir/name"\r\n.png' }, extension: '.png"\r\nX' } as ArtifactRecord;
  assert(!artifactContentDisposition(unsafe).includes('\r')); assert(!artifactContentDisposition(unsafe).includes('\n'));
});
test('unknown images, active documents and large/binary bodies have explicit download fallbacks', () => {
  assert.equal(artifactPresentation(record, Buffer.from('<svg onload="alert(1)"/>')).kind, 'download');
  assert.equal(artifactPresentation(record, Buffer.from('%PDF-1.7')).mediaType, 'application/pdf');
  const document = { ...record, kind: 'document' } as ArtifactRecord;
  assert.equal(artifactPresentation(document, Buffer.from('<html>source</html>')).mediaType, 'text/plain; charset=utf-8');
  assert.equal(artifactPresentation(document, Buffer.from([255,0,128])).kind, 'download');
  assert.equal(artifactPresentation(document, Buffer.alloc(1_048_577, 65)).kind, 'download');
  assert.equal(artifactPresentation(document, Buffer.from('')).kind, 'text');
});
