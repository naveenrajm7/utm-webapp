import { osBadge, type VM } from "../vm";

const VMIcon = ({
  vm,
  size = "small",
}: {
  vm: Pick<VM, "name" | "backend">;
  size?: "small" | "large";
}) => {
  const badge = osBadge(vm);
  return (
    <span
      className={`vm-icon vm-icon-${size} tone-${badge.tone}`}
      aria-hidden="true"
    >
      <i className={`bi ${badge.icon}`} />
    </span>
  );
};

export const AppIcon = ({ size = 28 }: { size?: number }) => (
  <span
    className="app-icon"
    style={{ width: size, height: size, fontSize: size * 0.55 }}
    aria-hidden="true"
  >
    <i className="bi bi-display" />
  </span>
);

export default VMIcon;
