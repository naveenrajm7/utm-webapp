"use client";

import { useParams } from 'next/navigation';
import ApiKeyGate from '../../components/ApiKeyGate';
import XTerminal from '../../components/xterminal';
import ConsoleGate from '../../components/ConsoleGate';

const TerminalPage: React.FC = () => {
  const params = useParams<{ vmUUID: string }>();
  const vmUUID = params?.vmUUID;

  if (!vmUUID) {
    return <div>No VM specified</div>;
  }

  return (
    <ApiKeyGate>
      <div style={{ width: '100vw', height: '100vh' }}>
        <ConsoleGate vmId={vmUUID} kind="serial">
          <XTerminal vmUUID={vmUUID} />
        </ConsoleGate>
      </div>
    </ApiKeyGate>
  );
};

export default TerminalPage;
