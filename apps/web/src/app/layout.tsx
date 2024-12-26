"use client";

import "./globals.css";
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import VMList from './components/VMList';
import VMInfo from './components/VMInfo';
import VMActionControls from './components/VMActionControls';
import { useRef, useState } from 'react';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const vmHeaderRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedVMUUID, setSelectedVMUUID] = useState<string | null>(null);

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isResizing || !sidebarRef.current || !mainContentRef.current || !vmHeaderRef.current) return;
    const minSidebarWidth = window.innerWidth / 4;
    const minMainContentWidth = window.innerWidth / 4;
    const newSidebarWidth = Math.max(e.clientX, minSidebarWidth);
    const newMainContentWidth = Math.max(window.innerWidth - newSidebarWidth, minMainContentWidth);

    if (newSidebarWidth + minMainContentWidth <= window.innerWidth) {
      sidebarRef.current.style.width = `${newSidebarWidth}px`;
      vmHeaderRef.current.style.width = `${newSidebarWidth}px`;
      mainContentRef.current.style.flexBasis = `${newMainContentWidth}px`;
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  return (
    <html lang="en">
      <body onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
        <header
          className="combined-header d-flex align-items-center"
          style={{ padding: '0.5rem 1rem' }}
        >
          {/* VM Header Section */}
          <div className="d-flex align-items-center vm-header" style={{ width: '300px' }}>
            <span onClick={() => setSelectedVMUUID(null)} style={{ cursor: 'pointer' }}>Virtual Machines</span>
          </div>

          {/* UTM Section */}
          <div className="d-flex align-items-center flex-grow-1">
            <button
              className="btn btn-primary"
              style={{
                backgroundColor: 'inherit',
                border: 'none',
                padding: 0,
              }}
            >
              <i className="bi bi-plus" style={{ fontSize: '1.5rem' }}></i>
            </button>
            <div className="d-flex align-items-center ml-3">
              <span>UTM</span>
            </div>
          </div>

          {/* Icons Section */}
          {selectedVMUUID && <VMActionControls vmUUID={selectedVMUUID} />}
        </header>
        <div className="d-flex" style={{ height: 'calc(100vh - 60px)' }}>
          <div ref={sidebarRef} className="sidebar flex-shrink-0" style={{ width: '300px' }}>
            <VMList onSelectVM={setSelectedVMUUID} />
          </div>
          <div
            className="resizer"
            onMouseDown={handleMouseDown}
            style={{
              width: '5px',
              cursor: 'col-resize',
              backgroundColor: '#444',
              height: '100%',
            }}
          ></div>
          <div ref={mainContentRef} className="main-content flex-grow-1">
            <main>
              {selectedVMUUID ? <VMInfo uuid={selectedVMUUID} /> : children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}