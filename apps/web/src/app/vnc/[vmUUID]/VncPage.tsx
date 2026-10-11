"use client";

import { useParams } from 'next/navigation';
import ApiKeyGate from '../../components/ApiKeyGate';
import VNCViewer from '../../components/VNCViewer';
import { getAuthenticatedWebSocketUrl } from '../../apiAuth';

const AuthenticatedVnc = ({ vmUUID }: { vmUUID: string }) => {
  const vncUrl = getAuthenticatedWebSocketUrl("/vnc", { vmUUID });

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <VNCViewer url={vncUrl} />
    </div>
  );
};

const VNCViewerPage: React.FC = () => {
  const params = useParams<{ vmUUID: string }>();
  const vmUUID = params?.vmUUID;

  if (!vmUUID) {
    return <div>No VM specified</div>;
  }

  return (
    <ApiKeyGate>
      <AuthenticatedVnc vmUUID={vmUUID} />
    </ApiKeyGate>
  );
};

export default VNCViewerPage;
