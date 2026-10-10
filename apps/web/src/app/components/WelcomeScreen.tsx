"use client";

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
        <p className="welcome-kicker">UTM Web</p>
        <h1>Virtual machines on this Mac</h1>
        <p>
          Select a machine to see its available consoles and details, or create
          a managed sandbox from an approved template.
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
