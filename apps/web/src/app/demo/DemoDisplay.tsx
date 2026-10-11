"use client";

import VMIcon from "../components/VMIcon";
import { DEMO_VMS } from "./fixtures";

const DemoDisplay = ({ url }: { url: string }) => {
  const vmId = new URL(url).searchParams.get("vmUUID");
  const vm = DEMO_VMS.find((item) => item.id === vmId);
  return (
    <div className="vnc-shell demo-display">
      <div className="demo-display-boot">
        {vm && <VMIcon vm={vm} size="large" />}
        <p>{vm?.name ?? "Virtual machine"}</p>
      </div>
      <p className="demo-display-note">
        Simulated display. A live VNC session needs UTM Web running on your Mac.
      </p>
    </div>
  );
};

export default DemoDisplay;
