import { exec } from "child_process";

export const getPtyDevice = (uuid: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const command = `utmctl attach ${uuid}`; // Replace with the actual command to get the pty device

    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(`Error getting pty device: ${stderr}`);
      }

      // Extract the PTY device from the command output
      const match = stdout.match(/PTTY:\s*(\/dev\/\w+)/);
      if (match && match[1]) {
        const ptyDevice = match[1].trim();
        resolve(ptyDevice);
      } else {
        reject("PTY device not found in command output");
      }
    });
  });
};