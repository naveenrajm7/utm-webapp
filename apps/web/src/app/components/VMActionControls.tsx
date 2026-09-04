import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../apiAuth';

const VMActionControls: React.FC<{ vmUUID: string }> = ({ vmUUID }) => {
  const [vmStatus, setVmStatus] = useState<string>('stopped'); // Default status

  const fetchVmStatus = useCallback(async () => {
    try {
      const response = await apiFetch(`/status_vm?uuid=${vmUUID}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch VM status: ${response.statusText}`);
      }

      const data = await response.json();
      setVmStatus(data.vmStatus);
    } catch (error) {
      console.error("Error fetching VM status:", error);
      // Set a fallback status in case of error
      setVmStatus('unknown');
    }
  }, [vmUUID]);

  // Fetch the VM status on mount or when vmUUID changes
  useEffect(() => {
    fetchVmStatus();
  }, [fetchVmStatus]);

  // Actions
  const runVmAction = async (action: 'start' | 'stop') => {
    try {
      const response = await apiFetch(`/${action}?uuid=${vmUUID}`, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || response.statusText);
      }

      setVmStatus(data.vmStatus);
    } catch (error) {
      console.error(`Error running ${action} on VM:`, error);
    }

    // UTM reports transitional states, so settle on the real one shortly after.
    setTimeout(fetchVmStatus, 2000);
  };

  const handlePlay = () => runVmAction('start');

  const handleStop = () => runVmAction('stop');

  const handleDelete = () => {
    console.log(`Deleting VM: ${vmUUID}`);
    // Add logic to delete VM
  };

  const handleClone = () => {
    console.log(`Cloning VM: ${vmUUID}`);
    // Add logic to clone VM
  };

  const handleConfigure = () => {
    console.log(`Configuring VM: ${vmUUID}`);
    // Add logic to configure VM
  };

  const handleConnect = () => {
    window.open(`/terminal/${vmUUID}`, '_blank');
  };

  const handleVNC = () => {
    window.open(`/vnc/${vmUUID}`, '_blank');
  };

  return (
    <div className="d-flex align-items-center justify-content-end">

      {/* VM Actions */}
      <button
        className="btn btn-link text-white p-0 mx-2"
        onClick={handleDelete}
        title="Delete VM"
        disabled={vmStatus === 'started'} // Disable only when VM is started
        style={{
          pointerEvents: vmStatus === 'started' ? 'none' : 'auto', // Disable interactions
          color: vmStatus === 'started' ? '#6c757d' : 'inherit', // Grey out icon if disabled
        }}
      >
        <i className="bi bi-trash" style={{ fontSize: '1.5rem' }}></i>
      </button>

      <button
        className="btn btn-link text-white p-0 mx-2"
        onClick={handleClone}
        title="Clone VM"
      >
        <i className="bi bi-files" style={{ fontSize: '1.5rem' }}></i>
      </button>

      {/* Connect Button */}
      {/* Serial connection */}
      <button
        className="btn btn-link text-white p-0 mx-2"
        onClick={handleConnect}
        title="Connect VM"
        disabled={vmStatus === 'stopped'} // Disable only when VM is stopped
        style={{
          pointerEvents: vmStatus === 'stopped' ? 'none' : 'auto', // Disable interactions
          color: vmStatus === 'stopped' ? '#6c757d' : 'inherit', // Grey out icon if disabled
        }}
      >
        <i className="bi bi-terminal" style={{ fontSize: '1.5rem' }}></i>
      </button>
      {/* VNC connection */}
      <button
        className="btn btn-link text-white p-0 mx-2"
        onClick={handleVNC}
        title="Connect VNC"
        disabled={vmStatus === 'stopped'} // Disable only when VM is stopped
        style={{
          pointerEvents: vmStatus === 'stopped' ? 'none' : 'auto', // Disable interactions
          color: vmStatus === 'stopped' ? '#6c757d' : 'inherit', // Grey out icon if disabled
        }}
      >
        <i className="bi bi-display" style={{ fontSize: '1.5rem' }}></i>
      </button>

      {/* Play/Stop Button */}
      {vmStatus === 'stopped' ? (
        <button
          className="btn btn-link text-white p-0 mx-2"
          onClick={handlePlay}
          title="Start VM"
        >
          <i className="bi bi-play" style={{ fontSize: '1.5rem' }}></i>
        </button>
      ) : (
        <button
          className="btn btn-link text-white p-0 mx-2"
          onClick={handleStop}
          title="Stop VM"
        >
          <i className="bi bi-stop-circle" style={{ fontSize: '1.5rem' }}></i>
        </button>
      )}

      {/* Configure Button */}
      <button
        className="btn btn-link text-white p-0 mx-2"
        onClick={handleConfigure}
        title="Configure VM"
        disabled={vmStatus === 'started'} // Disable only when VM is started
        style={{
          pointerEvents: vmStatus === 'started' ? 'none' : 'auto', // Disable interactions
          color: vmStatus === 'started' ? '#6c757d' : 'inherit', // Grey out icon if disabled
        }}
      >
        <i className="bi bi-sliders" style={{ fontSize: '1.5rem' }}></i>
      </button>

    </div>
  );
};

export default VMActionControls;