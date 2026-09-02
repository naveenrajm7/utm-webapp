"use client";

import { useParams } from 'next/navigation';
import XTerminal from '../../components/xterminal';

const TerminalPage: React.FC = () => {
  const params = useParams<{ vmUUID: string }>();
  const vmUUID = params?.vmUUID;

  if (!vmUUID) {
    return <div>No VM specified</div>;
  }

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <XTerminal vmUUID={vmUUID} />
    </div>
  );
};

export default TerminalPage;
