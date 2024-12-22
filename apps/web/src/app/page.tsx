"use client";

export default function Web() {

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ height: '100%' }}>
        <div className="text-center" style={{ width: '50%' }}>
            <div className="container">
                <div className="row justify-content-center">
                    <div className="row">
                        <div className="col">
                            <h4 className="mb-4" style={{color: '#ffffff'}}>Welcome to UTM</h4>
                        </div>
                    </div>
                    <div className="row">
                        <div className="col mb-3">
                            <button className="btn btn-lg btn-secondary d-flex flex-column align-items-center justify-content-center" 
                                    style={{ width: '100%', height: '150px', borderRadius: '15px' }}>
                                <i className="bi bi-plus-circle" style={{ fontSize: '3rem' }}></i>
                                <span style={{ fontSize: '0.8rem' }}>Create a New Virtual Machine</span>
                            </button>
                        </div>
                        <div className="col mb-3">
                            <a href="https://mac.getutm.app/gallery/" target="_blank" className="btn btn-lg btn-secondary d-flex flex-column align-items-center justify-content-center" 
                                    style={{ width: '100%', height: '150px', borderRadius: '15px' }}>
                                <i className="bi bi-download" style={{ fontSize: '3rem' }}></i>
                                <span style={{ fontSize: '0.8rem' }}>Browse UTM Gallery</span>
                            </a>
                        </div>
                    </div>
                    <div className="row">
                        <div className="col mb-3">
                            <a href="https://docs.getutm.app/basics/basics/" target="_blank" className="btn btn-lg btn-secondary d-flex flex-column align-items-center justify-content-center" 
                                    style={{ width: '100%', height: '150px', borderRadius: '15px' }}>
                                <i className="bi bi-book" style={{ fontSize: '3rem' }}></i>
                                <span style={{ fontSize: '0.8rem' }}>User Guide</span>
                            </a>
                        </div>
                        <div className="col mb-3">
                            <a href="https://docs.getutm.app/" target="_blank" className="btn btn-lg btn-secondary d-flex flex-column align-items-center justify-content-center" 
                                    style={{ width: '100%', height: '150px', borderRadius: '15px' }}>
                                <i className="bi bi-question-circle" style={{ fontSize: '3rem' }}></i>
                                <span style={{ fontSize: '0.8rem' }}>Support</span>
                            </a>
                        </div>
                    </div>
                    <div className="row">
                        <div className="col mb-3">
                            <a href="#" className="btn btn-lg btn-secondary d-flex align-items-center justify-content-center" 
                                    style={{ width: '100%', height: '60px', borderRadius: '15px' }}>
                                <i className="bi bi-hdd-stack" style={{ fontSize: '2rem', marginRight: '10px' }}></i>
                                <span style={{ fontSize: '0.8rem' }}>Server</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
