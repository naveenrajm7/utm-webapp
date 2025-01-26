"use client";

import { useSearchParams } from 'next/navigation';
import VNCViewer from '../../components/VNCViewer';

const VNCViewerPage: React.FC = () => {
  const searchParams = useSearchParams();
  const vmUUID = searchParams.get('vmUUID');

  console.log(vmUUID);
  // if (!vmUUID) {
  //   return <div>Loading...</div>;
  // }

  const vncUrl = `ws://localhost:15901`; // Replace with your VNC server URL

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <VNCViewer url={vncUrl} />
    </div>
  );
};

export default VNCViewerPage;