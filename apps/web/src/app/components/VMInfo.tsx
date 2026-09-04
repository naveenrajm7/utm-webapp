import React, { useEffect, useState } from 'react';
import { apiFetch } from '../apiAuth';

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
    apiFetch(`/vm_info?uuid=${uuid}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch VM info: ${response.statusText}`);
        }
        return response.json();
      })
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
      <i className="bi bi-info-circle" style={{ marginRight: '20px', verticalAlign: 'middle' }}></i>
      <span className="label"><strong>Status:</strong></span>
      <span className="value">{vmConfig.Status}</span>
    </div>
    <div className="vm-detail">
      <i className="bi bi-cpu" style={{ marginRight: '20px', verticalAlign: 'middle' }}></i>
      <span className="label"><strong>Architecture:</strong></span>
      <span className="value">{vmConfig.Architecture}</span>
    </div>
    <div className="vm-detail">
      <i className="bi bi-display" style={{ marginRight: '20px', verticalAlign: 'middle' }}></i>
      <span className="label"><strong>Machine:</strong></span>
      <span className="value">{vmConfig.Machine}</span>
    </div>
    <div className="vm-detail">
      <i className="bi bi-memory" style={{ marginRight: '20px', verticalAlign: 'middle' }}></i>
      <span className="label"><strong>Memory:</strong></span>
      <span className="value">{vmConfig.Memory} MB</span>
    </div>
  </div>
</div>
  );
};

export default VMInfo;