import "./globals.css";

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="d-flex">
                <nav className="sidebar col-3">
                    <header>Virtual Machines</header>
                    <a href="#">LinuxKernel</a>
                    <a href="#">micro</a>
                    <a href="#">RHEL</a>
                    <a href="#">QemuSnap</a>
                    <a href="#">macOS</a>
                    <a href="#">Windows11</a>
                    <a href="#">DebianCloud</a>
                </nav>
                <div className="main-content col-9">
                    <header className="main-content-header d-flex align-items-center" style={{ backgroundColor: 'inherit', color: 'inherit', padding: '0.5rem 1rem' }}>
                        <button className="btn btn-primary" style={{ backgroundColor: 'inherit', border: 'none', color: 'inherit', padding: 0 }}>
                            <i className="bi bi-plus" style={{ fontSize: '1.5rem', color: '#ffffff' }}></i>
                        </button>
                        <span className="ml-3" style={{color: '#ffffff'}}>UTM</span>
                    </header>
                    <main>
                        {children}
                    </main>
                </div>
            </div>
      </body>
    </html>
  );
}
