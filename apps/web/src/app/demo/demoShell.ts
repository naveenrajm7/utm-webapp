import type { Terminal } from "@xterm/xterm";

const PROMPT = "\x1b[1;32mroot@demo\x1b[0m:\x1b[1;34m~\x1b[0m# ";

const respond = (line: string): string => {
  const [command, ...args] = line.trim().split(/\s+/);
  switch (command) {
    case "":
      return "";
    case "help":
      return "Simulated commands: help, uname, whoami, hostname, ls, date, echo, clear\r\n";
    case "uname":
      return args.includes("-a")
        ? "Linux demo 6.8.0-45-generic #45-Ubuntu SMP aarch64 GNU/Linux\r\n"
        : "Linux\r\n";
    case "whoami":
      return "root\r\n";
    case "hostname":
      return "demo\r\n";
    case "ls":
      return "notes.txt  projects  snap\r\n";
    case "date":
      return `${new Date().toUTCString()}\r\n`;
    case "echo":
      return `${args.join(" ")}\r\n`;
    default:
      return `${command}: not available in this preview. Try 'help'.\r\n`;
  }
};

/** Stands in for the API's serial WebSocket in the static preview. */
export const attachDemoShell = (term: Terminal): (() => void) => {
  let line = "";
  term.write(
    "UTM Web preview ttyAMA0\r\n\r\n" +
      "This serial console is simulated. Run UTM Web on a Mac for a live VM.\r\n\r\n" +
      PROMPT,
  );
  const subscription = term.onData((data) => {
    for (const char of data) {
      if (char === "\r") {
        term.write("\r\n");
        if (line.trim() === "clear") term.clear();
        else term.write(respond(line));
        line = "";
        term.write(PROMPT);
      } else if (char === "\x7f") {
        if (line.length > 0) {
          line = line.slice(0, -1);
          term.write("\b \b");
        }
      } else if (char === "\x03") {
        line = "";
        term.write("^C\r\n" + PROMPT);
      } else if (char >= " ") {
        line += char;
        term.write(char);
      }
    }
  });
  return () => subscription.dispose();
};
