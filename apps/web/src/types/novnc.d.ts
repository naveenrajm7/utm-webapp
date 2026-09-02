/**
 * @novnc/novnc ships no type declarations. VNCViewer already holds the RFB class
 * loosely typed, so this only needs to make the dynamic import resolve.
 */
declare module '@novnc/novnc/lib/rfb' {
  const RFB: any;
  export default RFB;
}
