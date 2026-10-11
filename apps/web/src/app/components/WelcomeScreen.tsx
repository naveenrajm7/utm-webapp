"use client";

import { IS_DEMO } from "../demo";
import { AppIcon } from "./VMIcon";

const LINKS = [
  {
    href: "https://mac.getutm.app/gallery/",
    icon: "bi-download",
    title: "Browse UTM Gallery",
    detail: "Ready-made virtual machines",
  },
  {
    href: "https://docs.getutm.app/basics/basics/",
    icon: "bi-book",
    title: "User Guide",
    detail: "Install, start, and share VMs",
  },
  {
    href: "https://docs.getutm.app/",
    icon: "bi-question-circle",
    title: "Documentation",
    detail: "Settings, devices, and troubleshooting",
  },
];

export default function WelcomeScreen() {
  return (
    <div className="welcome">
      <div className="welcome-copy">
        <AppIcon size={88} />
        <h1>Welcome to UTM Web</h1>
        <p>
          {IS_DEMO
            ? "This preview runs entirely in your browser with simulated virtual machines. Pick one from the sidebar to try it."
            : "Select a machine to see its details, available consoles, and power controls."}
        </p>
      </div>
      <div className="welcome-links">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="welcome-link"
          >
            <i className={`bi ${link.icon}`} aria-hidden="true" />
            <span>
              <strong>{link.title}</strong>
              <span>{link.detail}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
