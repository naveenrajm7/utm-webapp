import { IS_DEMO } from "../../demo";
import { DEMO_VM_IDS } from "../../demo/fixtures";
import VncPage from "./VncPage";

export function generateStaticParams() {
  return IS_DEMO ? DEMO_VM_IDS.map((vmUUID) => ({ vmUUID })) : [];
}

export default function Page() {
  return <VncPage />;
}
