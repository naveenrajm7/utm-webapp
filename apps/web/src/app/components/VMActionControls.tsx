import React, { useEffect, useState } from 'react';

const VMActionControls: React.FC<{ vmUUID: string }> = ({ vmUUID }) => {
  const [vmStatus, setVmStatus] = useState<string>('stopped'); // Default status

  // Fetch the VM status on mount or when vmUUID changes
  useEffect(() => {
    const fetchVmStatus = async () => {
      try {
        // Replace this URL with your actual API endpoint
        const response = await fetch(`http://127.0.0.1:3001/status_vm?uuid=${vmUUID}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch VM status: ${response.statusText}`);
        }

        const data = await response.json();

        // Assuming the API response contains a "vmStatus" field
        setVmStatus(data.vmStatus);
      } catch (error) {
        console.error("Error fetching VM status:", error);
        // Set a fallback status in case of error
        setVmStatus('unknown');
      }
    };

    fetchVmStatus();
  }, [vmUUID]); // Re-run when vmUUID changes

  // Actions
  const handlePlay = () => {
    console.log(`Starting VM: ${vmUUID}`);
    // Add logic to start VM
    setVmStatus('running');
  };

  const handleStop = () => {
    console.log(`Stopping VM: ${vmUUID}`);
    // Add logic to stop VM
    setVmStatus('stopped');
  };

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
    console.log(`Connecting to VM via Serial: ${vmUUID}`);
    // Add logic to connect to VM
    window.open(`http://localhost:3002?vmUUID=${vmUUID}`, '_blank');
  };

  const handleVNC = () => {
    console.log(`Connecting to VM via VNC: ${vmUUID}`);
    // Add logic to connect to VM
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