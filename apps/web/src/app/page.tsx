import ApiKeyGate from './components/ApiKeyGate';
import VMManager from './components/VMManager';

export default function Web() {
  return (
    <ApiKeyGate>
      <VMManager />
    </ApiKeyGate>
  );
}
