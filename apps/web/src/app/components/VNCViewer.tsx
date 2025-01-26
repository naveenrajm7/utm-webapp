import React, { useEffect, useRef, useState } from 'react';
// import RFB from '@novnc/novnc/lib/rfb';

interface VNCViewerProps {
  url: string;
}

const VNCViewer: React.FC<VNCViewerProps> = ({ url }) => {
  const vncContainerRef = useRef<HTMLDivElement | null>(null);
  // const rfbRef = useRef<RFB | null>(null);
  const [RFB, setRFB] = useState<any>(null);

  useEffect(() => {
    // Dynamically import the RFB class from the @novnc/novnc library
    import('@novnc/novnc/lib/rfb').then((module) => {
      setRFB(() => module.default);
    });
  }, []);

  useEffect(() => {
    if (RFB && vncContainerRef.current) {
      const rfb = new RFB(vncContainerRef.current, url);
      // rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        console.log('Connected to VNC server');
      });

      rfb.addEventListener('disconnect', () => {
        console.log('Disconnected from VNC server');
      });

      return () => {
        if (rfb) {
          rfb.disconnect();
        }
      };
    }
  }, [RFB, url]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={vncContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default VNCViewer;