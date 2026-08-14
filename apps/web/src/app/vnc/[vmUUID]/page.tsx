"use client";

import { useParams } from 'next/navigation';
import VNCViewer from '../../components/VNCViewer';
import { getApiWebSocketHost } from '../../config';

const VNCViewerPage: React.FC = () => {
  const params = useParams<{ vmUUID: string }>();
  const vmUUID = params?.vmUUID;

  if (!vmUUID) {
    return <div>No VM specified</div>;
  }

  // The API resolves which VNC port this VM uses and relays it over WebSocket.
  const vncUrl = `${getApiWebSocketHost()}/vnc?vmUUID=${vmUUID}`;

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <VNCViewer url={vncUrl} />
    </div>
  );
};

export default VNCViewerPage;
