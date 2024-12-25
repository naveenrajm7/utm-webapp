import React, { useEffect, useState } from 'react';
import styles from './VMInfo.module.css';

interface VMInfoProps {
  uuid: string;
}

interface VMConfig {
  UUID: string;
  Name: string;
  Status: string;
  Architecture: string;
  Machine: string;
  Memory: number;
  SerialPorts: string[];
}

const VMInfo: React.FC<VMInfoProps> = ({ uuid }) => {
  const [vmConfig, setVmConfig] = useState<VMConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uuid) return;

    setLoading(true);
    fetch(`http://localhost:3001/vm_info?uuid=${uuid}`)
      .then(response => response.json())
      .then(data => {
        setVmConfig(data);
        setLoading(false);
      })
      .catch(error => {
        console.error('Error fetching VM info:', error);
        setLoading(false);
      });
  }, [uuid]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!vmConfig) {
    return <div>No VM info available</div>;
  }

  return (
<div className="vm-info-container">
  {/* VM Screen Placeholder */}
  <div className="vm-screen">
    <div className="vm-screen-placeholder">Screen Placeholder</div>
  </div>

  {/* VM Details */}
  <div className="vm-details">
    <div className="vm-detail">
      <span className="icon status-icon"></span>
      <span><strong>Status:</strong> {vmConfig.Status}</span>
    </div>
    <div className="vm-detail">
      <span className="icon architecture-icon"></span>
      <span><strong>Architecture:</strong> {vmConfig.Architecture}</span>
    </div>
    <div className="vm-detail">
      <span className="icon machine-icon"></span>
      <span><strong>Machine:</strong> {vmConfig.Machine}</span>
    </div>
    <div className="vm-detail">
      <span className="icon memory-icon"></span>
      <span><strong>Memory:</strong> {vmConfig.Memory} MB</span>
    </div>
    <div className="vm-detail">
      <span className="icon serial-icon"></span>
      <span><strong>Serial Ports:</strong> {vmConfig.SerialPorts.join(', ')}</span>
    </div>
  </div>
</div>
  );
};

export default VMInfo;