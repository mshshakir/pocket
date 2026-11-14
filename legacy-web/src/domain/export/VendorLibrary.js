/**
 * VendorLibrary — loads the export libraries (vendor/) the first time a file
 * is made, never on app start. They are served with the app, not from a
 * CDN, so exports keep working whatever a CDN does.
 *
 *   PDF   jsPDF 4 + jsPDF-AutoTable 5, with Noto Sans (subset: Latin,
 *         currency symbols such as ₹, arrows) so every character prints
 *   Excel write-excel-file
 */
export class VendorLibrary {
  static #loading = new Map();
  static #fonts = null;

  /** @returns {Promise<{jsPDF: Function, autoTable: Function}>} */
  static async pdf() {
    await VendorLibrary.#script('vendor/jspdf.umd.min.js');
    await VendorLibrary.#script('vendor/jspdf.plugin.autotable.min.js');
    const jsPDF = window.jspdf?.jsPDF;
    const autoTable = window.autoTable || window.jspdf_autotable?.autoTable;
    if (!jsPDF || !autoTable) throw new Error('The PDF library did not load');
    return { jsPDF, autoTable };
  }

  /** @returns {Promise<Function>} writeXlsxFile */
  static async excel() {
    await VendorLibrary.#script('vendor/write-excel-file.min.js');
    if (typeof window.writeXlsxFile !== 'function') throw new Error('The Excel library did not load');
    return window.writeXlsxFile;
  }

  /** Noto Sans regular and semibold as base64, for jsPDF's virtual file system. */
  static async fonts() {
    if (!VendorLibrary.#fonts) {
      VendorLibrary.#fonts = Promise.all(['NotoSans-Regular.ttf', 'NotoSans-SemiBold.ttf'].map(async (name) => {
        const res = await fetch(VendorLibrary.#url(`vendor/fonts/${name}`));
        if (!res.ok) throw new Error(`Font ${name}: HTTP ${res.status}`);
        return { name, base64: VendorLibrary.#base64(new Uint8Array(await res.arrayBuffer())) };
      })).catch((e) => { VendorLibrary.#fonts = null; throw e; });
    }
    return VendorLibrary.#fonts;
  }

  static #url(path) {
    return new URL(path, document.baseURI).href;
  }

  static #script(path) {
    const src = VendorLibrary.#url(path);
    if (!VendorLibrary.#loading.has(src)) {
      VendorLibrary.#loading.set(src, new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => { VendorLibrary.#loading.delete(src); reject(new Error(`Could not load ${path}`)); };
        document.head.appendChild(el);
      }));
    }
    return VendorLibrary.#loading.get(src);
  }

  static #base64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }
}
