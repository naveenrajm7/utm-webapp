"use client";

const DemoDisplay = () => (
  <div className="vnc-shell demo-display">
    <pre>
      {`Ubuntu 24.04.1 LTS demo tty1

demo login: _`}
    </pre>
    <p className="demo-display-note">
      Simulated display. A live VNC session needs UTM Web running on your Mac.
    </p>
  </div>
);

export default DemoDisplay;
