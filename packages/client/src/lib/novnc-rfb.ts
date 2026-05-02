// Thin re-export of the RFB class from @novnc/novnc (v1.7.0+).
//
// noVNC 1.7.0 ships as pure ESM ("type": "module") with its main entry point
// declared in package.json "exports": "./core/rfb.js".  This means a bare
// import('@novnc/novnc') resolves directly to the RFB class without any
// CJS-interop issues.  This wrapper keeps consumers decoupled from the exact
// package path and makes future upgrades a single-file change.
import RFB from '@novnc/novnc';
export default RFB;
