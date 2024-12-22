"use client";

import React, { useEffect, useState } from 'react';
import { API_HOST } from '../config';

interface VM {
  UUID: string;
  Name: string;
  Status: string;
}

const VMList: React.FC = () => {
  const [vms, setVMs] = useState<VM[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_HOST}/list_vms`)
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

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <>
      {vms.map(vm => (
        <a key={vm.UUID} href="#">
          <div className="flex-shrink-0 w-15 d-flex justify-content-center">
          <i className="bi bi-display"></i> {/* Dummy icon */}
          </div>
          <div className="flex-grow-1 text-truncate px-2">
            <span>{vm.Name}</span>
          </div>
          <div className="flex-shrink-0 w-15 d-flex justify-content-center">
            {vm.Status === 'stopped' && (
              <button className="btn btn-link p-0 text-white">
                <i className="bi bi-play-circle-fill"></i>
              </button>
            )}
          </div>
        </a>
      ))}
    </>
  );
};

export default VMList;