import React, { useEffect, useState } from 'react';
import { getApiHost } from '../config';

interface VM {
  UUID: string;
  Name: string;
  Status: string;
}

interface VMListProps {
  onSelectVM: (uuid: string) => void;
}

const VMList: React.FC<VMListProps> = ({ onSelectVM }) => {
  const [vms, setVMs] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeVMUUID, setActiveVMUUID] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiHost()}/list_vms`)
      .then(response => response.json())
      .then(data => {
        setVMs(data);
        setLoading(false);
      })
      .catch(error => {
        console.error('Error fetching VM list:', error);
        setLoading(false);
      });
  }, []);

  const handleClick = (uuid: string) => {
    setActiveVMUUID(uuid);
    onSelectVM(uuid);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <>
      {vms.map(vm => (
        <a
          key={vm.UUID}
          href="#"
          className={`list-group-item d-flex align-items-center sidebar-item ${activeVMUUID === vm.UUID ? 'active' : ''}`}
          onClick={() => handleClick(vm.UUID)}
        >
          <div className="flex-shrink-0 w-15 d-flex justify-content-center">
            <i className="bi bi-display"></i> {/* Display icon */}
          </div>
          <div className="flex-grow-1 text-truncate px-2">
            <span>{vm.Name}</span>
          </div>
          <div className="flex-shrink-0 w-15 d-flex justify-content-center">
            {vm.Status === 'stopped' && (
              <button className="btn btn-link p-0 text-white">
                <i className="bi bi-play-circle-fill"></i> {/* Play button icon */}
              </button>
            )}
          </div>
        </a>
      ))}
    </>
  );
};

export default VMList;