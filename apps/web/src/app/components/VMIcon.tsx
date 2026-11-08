import { osBadge, type VM } from "../vm";
import icons from "../utmIcons.json";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const iconFiles: Record<string, string> = icons;

const nativeIcon = (
  vm: Pick<VM, "name" | "backend" | "icon">,
): string | undefined => {
  const configured = vm.icon?.toLowerCase().replace(/\.png$/, "");
  if (configured && iconFiles[configured]) return iconFiles[configured];
  if (configured === "generic") return undefined;
  const badge = osBadge(vm);
  return {
    ubuntu: "ubuntu.png",
    windows: "windows-11.png",
    apple: "mac.png",
    linux: "linux.png",
    android: "android.png",
    generic: undefined,
  }[badge.tone];
};

const VMIcon = ({
  vm,
  size = "small",
}: {
  vm: Pick<VM, "name" | "backend" | "icon">;
  size?: "small" | "large";
}) => {
  const badge = osBadge(vm);
  const file = nativeIcon(vm);
  return (
    <span
      className={`vm-icon vm-icon-${size} tone-${badge.tone}`}
      aria-hidden="true"
    >
      {file ? (
        // These are the original bundled UTM icons; preserve their transparent edges.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${basePath}/utm-icons/${file}`} alt="" draggable={false} />
      ) : (
        <i className="bi bi-display" />
      )}
    </span>
  );
};

export const AppIcon = ({ size = 28 }: { size?: number }) => (
  <span
    className="app-icon"
    style={{ width: size, height: size }}
    aria-hidden="true"
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`${basePath}/utm-icons/app.png`} alt="" draggable={false} />
  </span>
);

export default VMIcon;
