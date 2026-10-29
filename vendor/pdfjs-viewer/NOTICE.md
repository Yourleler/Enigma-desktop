# Mozilla PDF.js full viewer

The files under web/ are unmodified files from Mozilla PDF.js 5.6.205, distributed under Apache-2.0. Copyright Mozilla Foundation and contributors. See LICENSE and the individual file headers. upstream.json records the verified release archive and each vendored file hash.

At build time Enigma generates enigma-viewer.html from viewer.html, adds a restrictive content policy links enigma-viewer.css, and appends the separately maintained Chinese translation patch. The application supplies document data and configures the official viewer in reading mode. The original upstream files are kept unchanged. The matching core/worker/font/CMap/ICC/WASM assets come from the pinned pdfjs-dist npm package, with their licenses.
